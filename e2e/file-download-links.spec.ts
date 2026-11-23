// The download of a file by a signed link, as an AI app or a program it hands the link to makes it: without a session
// cookie, with the token of the link as the only query besides `download`. The tokens are signed by
// `signFileLinkToken()` with the key of the database of the worker, as the server signs them.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { APIRequestContext, APIResponse } from "@playwright/test";

import { MCP_RATE_BURST } from "@/lib/env";

import { NO_STORAGE_STATE, USER_STORAGE_STATE } from "./support/auth";
import { createFile, createGrant, getTestDb, signFileLinkToken, testFilesDir } from "./support/database";
import { setUpProjects } from "./support/mcp";
import { expect, test } from "./support/test";

// Whoever holds a link has no session cookie.
test.use({ storageState: NO_STORAGE_STATE });

/** The headers of `next.config.ts` for the addresses of the files, which a download by link carries as well. */
const FILE_HEADERS = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
};

let projects: Awaited<ReturnType<typeof setUpProjects>>["projects"];
let grantId: string;
let image: Awaited<ReturnType<typeof createFile>>;
let pdf: Awaited<ReturnType<typeof createFile>>;

test.beforeEach(async () => {
  let owner;
  ({ projects, owner } = await setUpProjects());
  ({
    grant: { id: grantId },
  } = await createGrant({ owner, folder: projects }));
  image = await createFile({ folder: projects, name: "diagram.png", editor: owner });
  pdf = await createFile({ folder: projects, name: "manual.pdf", editor: owner });
});

/** The id of the current version of the file. */
function currentVersion(file: typeof image): string {
  const version = file.versions.at(-1);
  if (!version) throw new Error("no version");
  return version.id;
}

/** The token of a link of the grant to the current version of the file. */
function tokenOf(file: typeof image, options: { exp?: number; grant?: string } = {}): Promise<string> {
  return signFileLinkToken({ grant: options.grant ?? grantId, version: currentVersion(file), exp: options.exp });
}

/** Downloads the file of the name in "projects" with the token, by `GET` unless another method is given. */
function download(
  request: APIRequestContext,
  name: string,
  token: string,
  { method = "GET", query = "" }: { method?: "GET" | "HEAD"; query?: string } = {},
): Promise<APIResponse> {
  const address = `/files/projects/${name}?token=${token}${query}`;
  return request.fetch(address, { method, maxRedirects: 0 });
}

/** The headers of a file of `next.config.ts` in the answer. */
function fileHeadersOf(response: APIResponse): Record<string, string | undefined> {
  const headers = response.headers();
  return Object.fromEntries(Object.keys(FILE_HEADERS).map((name) => [name, headers[name]]));
}

test("a GET and a HEAD with a valid token and without a cookie download the image and the PDF with the headers of a file and no-store", async ({
  request,
}) => {
  for (const [file, type, bytes] of [
    [image, "image/png", await readBytes(image)],
    [pdf, "application/pdf", await readBytes(pdf)],
  ] as const) {
    const token = await tokenOf(file);

    const got = await download(request, file.name, token);
    expect(got.status(), file.name).toBe(200);
    expect(got.headers()["content-type"]).toBe(type);
    expect(got.headers()["content-disposition"]).toBe(`inline; filename="${file.name}"`);
    expect(got.headers()["cache-control"]).toBe("private, no-store");
    expect(got.headers().etag).toBe(`"${file.versions.at(-1)?.sha256}"`);
    expect(fileHeadersOf(got)).toEqual(FILE_HEADERS);
    expect(got.headers()).not.toHaveProperty("x-powered-by");
    expect(await got.body()).toEqual(bytes);

    const head = await download(request, file.name, token, { method: "HEAD" });
    expect(head.status(), file.name).toBe(200);
    expect(head.headers()["cache-control"]).toBe("private, no-store");
    expect(head.headers()["content-type"]).toBe(type);
    expect(await head.body()).toHaveLength(0);
    expect(fileHeadersOf(head)).toEqual(FILE_HEADERS);
  }
});

test("with download the file comes as an attachment", async ({ request }) => {
  const response = await download(request, "manual.pdf", await tokenOf(pdf), { query: "&download" });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toBe('attachment; filename="manual.pdf"');
});

test.describe("a link that no longer passes", () => {
  /** The answer to a file that does not exist, for a user with a session, to compare the refusals with. */
  let missing: { status: number; body: string };

  test.beforeEach(async ({ browser }) => {
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    const response = await context.request.get("/files/projects/missing.png", { maxRedirects: 0 });
    missing = { status: response.status(), body: await response.text() };
    await context.close();
    expect(missing.status).toBe(404);
  });

  /** Fails unless the answer is the plain 404 of a file that does not exist. */
  async function expectMissing(response: APIResponse, what: string): Promise<void> {
    expect({ status: response.status(), body: await response.text() }, what).toEqual(missing);
    expect(response.headers().location, what).toBeUndefined();
  }

  test("an expired token answers the 404 of a missing file", async ({ request }) => {
    const token = await tokenOf(image, { exp: Math.floor(Date.now() / 1000) - 1 });

    await expectMissing(await download(request, "diagram.png", token), "expired");
  });

  test("a token with a changed signature answers the 404 of a missing file", async ({ request }) => {
    const token = await tokenOf(image);
    const changed = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    await expectMissing(await download(request, "diagram.png", changed), "changed signature");
  });

  test("a token of a revoked grant answers the 404 of a missing file", async ({ request }) => {
    const token = await tokenOf(image);
    await getTestDb().oAuthGrant.delete({ where: { id: grantId } });

    await expectMissing(await download(request, "diagram.png", token), "revoked");
  });

  test("a token of an earlier version answers the 404 of a missing file once there is a new version", async ({
    request,
  }) => {
    const token = await tokenOf(pdf);
    const [first] = pdf.versions;
    if (!first) throw new Error("no version");
    const { fileId, sha256, size, width, height, userId, via } = first;
    await getTestDb().fileVersion.create({ data: { fileId, number: 2, sha256, size, width, height, userId, via } });

    await expectMissing(await download(request, "manual.pdf", token), "new version");
  });

  test("a token of a deleted file answers the 404 of a missing file", async ({ request }) => {
    const token = await tokenOf(image);
    await getTestDb().file.update({ where: { id: image.id }, data: { deletedAt: new Date(), tabId: null } });

    await expectMissing(await download(request, "diagram.png", token), "deleted");
  });

  test("a token with another query than download answers the 404 of a missing file", async ({ request }) => {
    const token = await tokenOf(image);

    for (const query of ["&version=1", `&token=${token}`, "&download=1"]) {
      await expectMissing(await download(request, "diagram.png", token, { query }), query);
    }
  });
});

test("a file downloads more often by link than the burst of the rate limit of MCP", async ({ request }) => {
  const token = await tokenOf(image);

  for (let index = 0; index <= MCP_RATE_BURST.default; index += 1) {
    const response = await download(request, "diagram.png", token, { method: "HEAD" });
    expect(response.status(), `download ${index + 1}`).toBe(200);
  }
  expect((await download(request, "diagram.png", token)).status()).toBe(200);
});

/** The bytes of the current version of the file, read from the files directory as the server sends them. */
function readBytes(file: typeof image): Promise<Buffer> {
  const sha256 = file.versions.at(-1)?.sha256 ?? "";
  return readFile(join(testFilesDir(), "blobs", sha256.slice(0, 2), sha256));
}
