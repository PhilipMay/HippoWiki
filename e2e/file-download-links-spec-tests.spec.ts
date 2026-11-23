// Tests of signed file links written from spec/signed-file-links-requirements.md alone: what the tool
// get_file_download_link of a real server hands out, and how a download by link answers with and without a session
// cookie. The rules that e2e/file-download-links.spec.ts and the unit and integration tests already check are left to
// them.
import { createHmac } from "node:crypto";

import type { APIRequestContext, APIResponse } from "@playwright/test";

import { hashSecret } from "@/features/oauth/secret";
import { USER_TEXT_NOTE } from "@/features/mcp/tool-schemas";

import { KNOWN_USER } from "../prisma/known-users";
import { NO_STORAGE_STATE, USER_STORAGE_STATE } from "./support/auth";
import {
  createFile,
  createFolder,
  createFolderRole,
  createPage,
  createTab,
  getTestDb,
  signFileLinkToken,
} from "./support/database";
import { pngBytes } from "./support/files";
import { call, setUpProjects } from "./support/mcp";
import { ISSUER } from "./support/oauth";
import { expect, test } from "./support/test";

// Whoever holds a link has no session cookie; a test that needs one opens a browser context of its own.
test.use({ storageState: NO_STORAGE_STATE });

let projects: Awaited<ReturnType<typeof setUpProjects>>["projects"];
let owner: Awaited<ReturnType<typeof setUpProjects>>["owner"];
/** The access token of the Reader connection of the owner, with which `call()` calls the tools. */
let secret: string;
/** The tab "guides" of "projects". */
let guides: Awaited<ReturnType<typeof createTab>>;
/** The image of the tests, in the tab "guides" of "projects", with two versions of different sizes. */
let diagram: Awaited<ReturnType<typeof createFile>>;

test.beforeEach(async () => {
  ({ projects, owner, secret } = await setUpProjects());
  guides = await createTab({ folder: projects, name: "guides", editor: owner });
  diagram = await createFile({
    tab: guides,
    name: "diagram.png",
    editor: owner,
    versions: [{ bytes: await pngBytes(10, 10) }, { bytes: await pngBytes(30, 20) }],
  });
});

/** The current version of the image of the tests. */
function currentVersion() {
  const version = diagram.versions.at(-1);
  if (!version) throw new Error("no version");
  return version;
}

/** The result of get_file_download_link for the image of the tests over the Reader connection of the owner. */
async function linkOfDiagram(request: APIRequestContext) {
  const result = await call(request, "get_file_download_link", { tab: "guides", file: "diagram.png" });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return result;
}

/** The token of a link, and its data and signature parts. */
function partsOf(downloadLink: string): { token: string; dataPart: string; signature: string } {
  const token = new URL(downloadLink).searchParams.get("token") ?? "";
  const [dataPart = "", signature = ""] = token.split(".");
  return { token, dataPart, signature };
}

/** The id of the grant of the Reader connection of the owner. */
async function grantId(): Promise<string> {
  return (await getTestDb().oAuthGrant.findUniqueOrThrow({ where: { accessTokenHash: hashSecret(secret) } })).id;
}

/** The key of the links as the database keeps it (see `signFileLinkToken()`), once a link has been made. */
async function linkKey(): Promise<Buffer> {
  const { secret: stored } = await getTestDb().fileLinkKey.findUniqueOrThrow({ where: { id: 1 } });
  return Buffer.from(stored, "hex");
}

// spec/signed-file-links-requirements.md, "The tool", R3
test("the link of a file in a tab is the public URL, the path of the file address and the token as its only query", async ({
  request,
}) => {
  const result = await linkOfDiagram(request);
  const { downloadLink } = result.structuredContent as { downloadLink: string };
  const { token } = partsOf(downloadLink);

  expect(token).not.toBe("");
  expect(downloadLink).toBe(`${ISSUER}/files/projects/guides/diagram.png?token=${token}`);
  expect([...new URL(downloadLink).searchParams.keys()]).toEqual(["token"]);
});

// spec/signed-file-links-requirements.md, "The tool", R4 (and R18 for the default lifetime of 600 seconds)
test("the result holds the note first, then the name, tab, type and size of the current version, the link and its expiry of now plus 600 seconds, in the data and in the text", async ({
  request,
}) => {
  const before = Math.floor(Date.now() / 1000);
  const result = await linkOfDiagram(request);
  const after = Math.ceil(Date.now() / 1000);
  const read = await call(request, "read_file", { tab: "guides", file: "diagram.png" });
  const readData = read.structuredContent as { type: string; size: number };

  const data = result.structuredContent as Record<string, unknown>;
  expect(Object.keys(data)[0]).toBe("note");
  expect(Object.keys(data).sort()).toEqual(["downloadLink", "expiresAt", "name", "note", "size", "tab", "type"]);
  expect(data).toMatchObject({
    note: USER_TEXT_NOTE,
    name: "diagram.png",
    tab: "guides",
    type: readData.type,
    size: currentVersion().size,
  });
  expect(readData.size).toBe(currentVersion().size);

  const expiresAt = data.expiresAt as string;
  expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  const expiry = Date.parse(expiresAt) / 1000;
  expect(expiry).toBeGreaterThanOrEqual(before + 600);
  expect(expiry).toBeLessThanOrEqual(after + 600);

  expect(result.content).toHaveLength(1);
  const text = JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>;
  expect(Object.keys(text)[0]).toBe("note");
  expect(text).toEqual(data);
});

// spec/signed-file-links-requirements.md, "What a link holds", R7
test("the data of a link holds exactly use, v, the grant of the connection, the id of the current version and exp", async ({
  request,
}) => {
  const result = await linkOfDiagram(request);
  const { downloadLink, expiresAt } = result.structuredContent as { downloadLink: string; expiresAt: string };
  const { dataPart } = partsOf(downloadLink);

  const data = JSON.parse(Buffer.from(dataPart, "base64url").toString("utf8")) as Record<string, unknown>;

  expect(data).toStrictEqual({
    use: "file-link",
    v: 1,
    grant: await grantId(),
    version: currentVersion().id,
    exp: Math.floor(Date.parse(expiresAt) / 1000),
  });
  expect(Number.isInteger(data.exp)).toBe(true);
});

// spec/signed-file-links-requirements.md, "What a link holds", R8
test("the signature of a link is the HMAC-SHA256 of its data part with the key of the links, both in base64url without padding", async ({
  request,
}) => {
  const result = await linkOfDiagram(request);
  const { token, dataPart, signature } = partsOf((result.structuredContent as { downloadLink: string }).downloadLink);

  expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  expect(Buffer.from(dataPart, "base64url").toString("base64url")).toBe(dataPart);
  expect(
    createHmac("sha256", await linkKey())
      .update(dataPart)
      .digest("base64url"),
  ).toBe(signature);
});

// spec/signed-file-links-requirements.md, "The tool", R2 (and R1 for a page name)
test("a page name, a missing file, a deleted file and a file of another folder get the tool error of read_file and no link", async ({
  request,
}) => {
  await createPage({ folder: projects, tab: guides, name: "setup", content: "# Setup", editor: owner });
  await createFile({ folder: projects, name: "old.png", deletedAt: new Date(), editor: owner });
  await createFile({ folder: await createFolder({ name: "notes" }), name: "elsewhere.png" });

  for (const args of [
    { tab: "guides", file: "setup" },
    { tab: "guides", file: "gone.png" },
    { file: "old.png" },
    { file: "elsewhere.png" },
  ]) {
    const what = JSON.stringify(args);
    const read = await call(request, "read_file", args);
    const result = await call(request, "get_file_download_link", args);

    expect(read.isError, what).toBe(true);
    expect(read.content[0]?.text, what).toContain("list_folder");
    expect(result.isError, what).toBe(true);
    expect(result.content, what).toEqual(read.content);
    expect(JSON.stringify(result), what).not.toContain("token=");
  }
});

test.describe("a download by link, with and without a session cookie", () => {
  /** The answer to a file that does not exist, for the known user, to compare the refusals with. */
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

  // spec/signed-file-links-requirements.md, "Downloading with a link", R10
  test("a valid link downloads with the session cookie of a user who may not read the file, checked by the token alone", async ({
    browser,
  }) => {
    const token = await signFileLinkToken({ grant: await grantId(), version: currentVersion().id });
    // The known user `alice` has no role on "projects": without the token her session finds no file there.
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    try {
      const withoutToken = await context.request.get("/files/projects/guides/diagram.png", { maxRedirects: 0 });
      expect(withoutToken.status()).toBe(404);

      const response = await context.request.get(`/files/projects/guides/diagram.png?token=${token}`, {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
      expect(response.headers()["cache-control"]).toBe("private, no-store");
    } finally {
      await context.close();
    }
  });

  // spec/signed-file-links-requirements.md, "Downloading with a link", R10
  test("an invalid token with the session cookie of a user who may read the file answers the plain 404", async ({
    browser,
  }) => {
    await createFolderRole({ folder: projects, user: { id: KNOWN_USER.id }, role: "reader" });
    const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
    try {
      const withoutToken = await context.request.get("/files/projects/guides/diagram.png", { maxRedirects: 0 });
      expect(withoutToken.status()).toBe(200);

      for (const token of ["", "invalid", "x.y"]) {
        const response = await context.request.get(`/files/projects/guides/diagram.png?token=${token}`, {
          maxRedirects: 0,
        });
        await expectMissing(response, `token=${token}`);
      }
    } finally {
      await context.close();
    }
  });

  // spec/signed-file-links-requirements.md, "Downloading with a link", R16, for the failures of R11 and R12 that no
  // other end-to-end test sends to the server; the check of each is unit tested in src/features/files/link-token.test.ts.
  test("a malformed token, data that is no data of a link and an expiry beyond the lifetime each answer the plain 404 of a missing file", async ({
    request,
  }) => {
    const grant = await grantId();
    const version = currentVersion().id;
    const valid = await signFileLinkToken({ grant, version });
    const [dataPart = "", signature = ""] = valid.split(".");
    const key = await linkKey();
    const longData = "A".repeat(10_000);
    const signed = (changes: Record<string, unknown>) => signFileLinkToken({ grant, version, changes });

    const tokens: [string, string][] = [
      ["a token without a dot", `${dataPart}${signature}`],
      ["a data part with =", `${dataPart}=.${signature}`],
      ["a signature with +", `${dataPart}.${signature.slice(0, -1)}+`],
      ["a signature with /", `${dataPart}.${signature.slice(0, -1)}/`],
      [
        "a data part of 10,000 characters",
        `${longData}.${createHmac("sha256", key).update(longData).digest("base64url")}`,
      ],
      ["a signature of 42 characters", `${dataPart}.${signature.slice(0, 42)}`],
      ["a signature of 44 characters", `${dataPart}.${signature}A`],
      ["another use", await signed({ use: "session" })],
      ["another v", await signed({ v: 2 })],
      ["an extra field", await signed({ extra: 1 })],
      ["a missing field", await signed({ exp: undefined })],
      ["exp as a string", await signed({ exp: String(Math.floor(Date.now() / 1000) + 600) })],
      ["exp as a fraction", await signed({ exp: Math.floor(Date.now() / 1000) + 600.5 })],
      ["a version that is no UUID", await signed({ version: "2" })],
      ["an expiry further away than the lifetime", await signed({ exp: Math.floor(Date.now() / 1000) + 1200 })],
    ];

    // The valid token itself downloads, so each refusal below is one of the change alone.
    expect((await request.get(`/files/projects/guides/diagram.png?token=${valid}`, { maxRedirects: 0 })).status()).toBe(
      200,
    );
    for (const [what, token] of tokens) {
      const response = await request.get(`/files/projects/guides/diagram.png?token=${encodeURIComponent(token)}`, {
        maxRedirects: 0,
      });
      await expectMissing(response, what);
    }
  });
});

// spec/signed-file-links-requirements.md, "Downloading with a link", R10: `download` is the one other query allowed,
// with no order between the two.
test("download before the token also answers the file as an attachment", async ({ request }) => {
  const token = await signFileLinkToken({ grant: await grantId(), version: currentVersion().id });

  const response = await request.get(`/files/projects/guides/diagram.png?download&token=${token}`, {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toBe('attachment; filename="diagram.png"');
});
