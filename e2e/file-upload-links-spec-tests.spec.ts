// Tests of signed upload links written from the requirements alone (spec/signed-upload-links-requirements.md), for
// what only the running server shows: the answers of the upload address to a `POST` by link, without a session
// cookie, as `curl` sends it. The links are signed by `signUploadLinkToken()` with the key of the database of the
// worker, as the server signs them. The other rules are checked by e2e/file-upload-links.spec.ts and by
// integration/file-upload-links.spec-tests.test.ts.
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { NO_STORAGE_STATE } from "./support/auth";
import { createFile, createGrant, createTab, getTestDb, signUploadLinkToken } from "./support/database";
import { pdfBytes, pngBytes } from "./support/files";
import { callTool, mcpPath, setUpProjects } from "./support/mcp";
import { expect, test } from "./support/test";

// Whoever holds a link has no session cookie.
test.use({ storageState: NO_STORAGE_STATE });

let projects: Awaited<ReturnType<typeof setUpProjects>>["projects"];
let owner: Awaited<ReturnType<typeof setUpProjects>>["owner"];
let grantId: string;
let writerToken: string;
let guides: Awaited<ReturnType<typeof createTab>>;

test.beforeEach(async () => {
  ({ projects, owner } = await setUpProjects());
  const writer = await createGrant({ owner, folder: projects, role: "writer" });
  grantId = writer.grant.id;
  writerToken = writer.accessToken;
  guides = await createTab({ folder: projects, name: "guides" });
});

/** Posts the bytes to the upload address of the place with the query, as `curl` does: without `Origin`. */
function post(request: APIRequestContext, path: string, query: string, bytes: Uint8Array): Promise<APIResponse> {
  return request.post(`/api/uploads/projects/${path}${query}`, {
    data: Buffer.from(bytes),
    headers: { "content-type": "application/octet-stream" },
    maxRedirects: 0,
  });
}

// spec/signed-upload-links-requirements.md, R14: the answer of a stored upload, with the links of read_file
test("the answer of an upload by link holds the file as stored, with the same links as read_file", async ({
  request,
}) => {
  const writer = { address: mcpPath(projects, "writer"), token: writerToken };
  const image = await pngBytes(64, 48);
  const pdf = pdfBytes("A manual uploaded by link");
  const manual = await createFile({ folder: projects, name: "manual.pdf", editor: owner });

  for (const [what, path, bytes, token, tab, name] of [
    [
      "a new image in a tab",
      "guides/screenshot.png",
      image,
      await signUploadLinkToken({ grant: grantId, tab: guides.id, name: "screenshot.png", size: image.length }),
      "guides",
      "screenshot.png",
    ],
    [
      "a new version of a PDF in the folder",
      "manual.pdf",
      pdf,
      await signUploadLinkToken({
        grant: grantId,
        name: "manual.pdf",
        size: pdf.length,
        strip: false,
        file: manual.id,
        lockVersion: manual.lockVersion,
      }),
      null,
      "manual.pdf",
    ],
  ] as const) {
    const response = await post(request, path, `?token=${token}`, bytes);
    expect(response.status(), what).toBe(201);
    const answer = (await response.json()) as Record<string, unknown>;

    const read = (await callTool(request, writer, "read_file", { tab, file: name })).structuredContent as Record<
      string,
      unknown
    >;
    expect(answer, what).toMatchObject({
      name: read.name,
      tab: read.tab,
      type: read.type,
      size: read.size,
      version: read.versions,
      width: read.width,
      height: read.height,
      wikiLink: read.wikiLink,
      embedLink: read.embedLink,
    });
  }
});

// spec/signed-upload-links-requirements.md, R15: a broken, forged, expired or no longer accepted link gets one and the
// same plain 404
test("a broken link and a link whose app may no longer upload get the same status and body as an expired link, and store nothing", async ({
  request,
}) => {
  const image = await pngBytes();
  const link = { grant: grantId, tab: guides.id, name: "screenshot.png", size: image.length };
  const expired = await signUploadLinkToken({ ...link, exp: Math.floor(Date.now() / 1000) - 1 });
  const valid = await signUploadLinkToken(link);
  const [dataPart = ""] = valid.split(".");
  const withoutSize = await signUploadLinkToken({ ...link, changes: { size: undefined } });

  const expectedAnswer = await post(request, "guides/screenshot.png", `?token=${expired}`, image);
  expect(expectedAnswer.status()).toBe(404);
  const expectedBody = await expectedAnswer.text();

  await getTestDb().folderRole.update({
    where: { folderId_userId: { folderId: projects.id, userId: owner.id } },
    data: { role: "reader" },
  });
  for (const [what, query] of [
    ["an empty token", "?token="],
    ["a token that is no token", "?token=not-a-token"],
    ["the data of a token without its signature", `?token=${dataPart}`],
    ["a signed token whose data lack the size", `?token=${withoutSize}`],
    ["a valid link of a user whose role was lowered below the grant", `?token=${valid}`],
  ] as const) {
    const response = await post(request, "guides/screenshot.png", query, image);
    expect({ status: response.status(), body: await response.text() }, what).toEqual({
      status: 404,
      body: expectedBody,
    });
  }
  expect(await getTestDb().file.count({ where: { folderId: projects.id } })).toBe(0);
});
