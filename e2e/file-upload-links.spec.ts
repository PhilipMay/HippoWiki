// The upload of a file by a signed upload link, as an AI app makes it with `curl`: a `POST` of the bytes of the file to
// the upload address with the token of the link as its only query, without a session cookie. The links are signed by
// `signUploadLinkToken()` with the key of the database of the worker, as the server signs them, also to make one that
// has expired or is broken.
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { logIn, NO_STORAGE_STATE, USER_STORAGE_STATE } from "./support/auth";
import {
  createFile,
  createGrant,
  createPage,
  createTab,
  getTestDb,
  signFileLinkToken,
  signUploadLinkToken,
} from "./support/database";
import { pdfBytes, pngBytes } from "./support/files";
import { send, setUpProjects } from "./support/mcp";
import { expect, test } from "./support/test";

// Whoever holds a link has no session cookie.
test.use({ storageState: NO_STORAGE_STATE });

let projects: Awaited<ReturnType<typeof setUpProjects>>["projects"];
let owner: Awaited<ReturnType<typeof setUpProjects>>["owner"];
/** The grant of the Writer connection of the owner to "projects", which the links name. */
let grantId: string;
let guides: Awaited<ReturnType<typeof createTab>>;
let manual: Awaited<ReturnType<typeof createFile>>;

test.beforeEach(async () => {
  ({ projects, owner } = await setUpProjects());
  ({
    grant: { id: grantId },
  } = await createGrant({ owner, folder: projects, role: "writer" }));
  guides = await createTab({ folder: projects, name: "guides" });
  manual = await createFile({ folder: projects, name: "manual.pdf", editor: owner, versions: [{ bytes: pdfBytes() }] });
});

/** Posts the bytes to the upload address of the place with the given query, as `curl` does: without `Origin`. */
function post(
  request: APIRequestContext,
  path: string,
  query: string,
  bytes: Uint8Array,
  headers: Record<string, string> = {},
): Promise<APIResponse> {
  return request.post(`/api/uploads/projects/${path}${query}`, {
    data: Buffer.from(bytes),
    headers: { "content-type": "application/octet-stream", ...headers },
    maxRedirects: 0,
  });
}

/** The token of a link of the Writer grant for a new image `screenshot.png` of the given bytes in the tab guides. */
function screenshotToken(bytes: Uint8Array, changes: { exp?: number; grant?: string } = {}): Promise<string> {
  return signUploadLinkToken({
    grant: changes.grant ?? grantId,
    tab: guides.id,
    name: "screenshot.png",
    size: bytes.length,
    ...(changes.exp === undefined ? {} : { exp: changes.exp }),
  });
}

/** How many files of the folder there are, deleted ones included, and how many versions all of them have. */
async function counts(): Promise<{ files: number; versions: number }> {
  return {
    files: await getTestDb().file.count({ where: { folderId: projects.id } }),
    versions: await getTestDb().fileVersion.count({ where: { file: { folderId: projects.id } } }),
  };
}

test("a new image and a new version of a PDF are stored by link, by the user of the connection through MCP, and the answer holds what a page needs", async ({
  request,
  page,
}) => {
  const image = await pngBytes(64, 48);
  const imageAnswer = await post(request, "guides/screenshot.png", `?token=${await screenshotToken(image)}`, image);

  expect(imageAnswer.status()).toBe(201);
  expect(await imageAnswer.json()).toStrictEqual({
    ok: true,
    name: "screenshot.png",
    tab: "guides",
    type: "png",
    size: expect.any(Number),
    version: 1,
    width: 64,
    height: 48,
    wikiLink: "[[guides/screenshot.png]]",
    embedLink: "![[guides/screenshot.png]]",
  });

  const second = pdfBytes("The second version");
  const pdfToken = await signUploadLinkToken({
    grant: grantId,
    name: "manual.pdf",
    size: second.length,
    strip: false,
    file: manual.id,
    lockVersion: manual.lockVersion,
  });
  const pdfAnswer = await post(request, "manual.pdf", `?token=${pdfToken}`, second);

  expect(pdfAnswer.status()).toBe(201);
  expect(await pdfAnswer.json()).toStrictEqual({
    ok: true,
    name: "manual.pdf",
    tab: null,
    type: "pdf",
    size: second.length,
    version: 2,
    width: null,
    height: null,
    wikiLink: "[[manual.pdf]]",
    embedLink: null,
  });

  await logIn(page, owner.username);
  await expect(page).toHaveURL("/folders");
  for (const address of ["/folders/projects/guides/screenshot.png", "/folders/projects/manual.pdf"]) {
    await page.goto(address);
    const versions = page.getByRole("table", { name: "Versions" });
    await expect(versions.getByRole("row").nth(1), address).toContainText(owner.username);
    await expect(versions.getByRole("row").nth(1), address).toContainText("mcp");
  }
  await expect(page.getByRole("table", { name: "Versions" }).getByRole("link", { name: /^Version/ })).toHaveText([
    "Version 2",
    "Version 1",
  ]);
  const response = await page.request.get("/files/projects/manual.pdf");
  expect(await response.body()).toEqual(second);
});

test("an upload by link with the session cookie of another user is stored with the user of the connection", async ({
  browser,
}) => {
  const image = await pngBytes();
  const token = await screenshotToken(image);
  // The known user `alice` has no role on "projects": her session could upload nothing there.
  const context = await browser.newContext({ storageState: USER_STORAGE_STATE });
  try {
    const response = await post(context.request, "guides/screenshot.png", `?token=${token}`, image);
    expect(response.status()).toBe(201);
  } finally {
    await context.close();
  }

  const file = await getTestDb().file.findFirstOrThrow({
    where: { name: "screenshot.png" },
    include: { versions: true },
  });
  expect(file.lastEditedById).toBe(owner.id);
  expect(file.versions.map(({ userId, via }) => [userId, via])).toEqual([[owner.id, "mcp"]]);
});

test("a query besides the one token is refused and stores nothing", async ({ request }) => {
  const image = await pngBytes();
  const token = await screenshotToken(image);
  const before = await counts();

  for (const query of [
    `?token=${token}&replace=1`,
    `?token=${token}&removeMetadata=0`,
    `?token=${token}&token=${token}`,
  ]) {
    const response = await post(request, "guides/screenshot.png", query, image);
    expect(response.status(), query).toBe(404);
  }
  expect(await counts()).toEqual(before);
});

test("an upload by link from another site is refused, and the same upload without Origin is stored", async ({
  request,
}) => {
  const image = await pngBytes();
  const token = await screenshotToken(image);
  const before = await counts();

  const foreign: Record<string, string>[] = [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }];
  for (const headers of foreign) {
    const response = await post(request, "guides/screenshot.png", `?token=${token}`, image, headers);
    expect(response.status(), JSON.stringify(headers)).toBe(404);
  }
  expect(await counts()).toEqual(before);

  const response = await post(request, "guides/screenshot.png", `?token=${token}`, image);
  expect(response.status()).toBe(201);
});

test("a file of one byte more or one byte less than the stated size is refused and stores nothing", async ({
  request,
}) => {
  const image = await pngBytes();
  const token = await screenshotToken(image);
  const before = await counts();

  for (const bytes of [Buffer.concat([image, Buffer.from([0])]), image.subarray(0, -1)]) {
    const response = await post(request, "guides/screenshot.png", `?token=${token}`, bytes);
    expect(response.status(), String(bytes.length)).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "wrong-size" });
  }
  expect(await counts()).toEqual(before);
});

test("an expired link, a forged link and a link of a revoked app get the same status and body, and a token of one kind never passes for the other", async ({
  request,
}) => {
  const image = await pngBytes();
  const expired = await screenshotToken(image, { exp: Math.floor(Date.now() / 1000) - 1 });
  const valid = await screenshotToken(image);
  const forged = `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`;
  const { grant: revoked } = await createGrant({ owner, folder: projects, role: "writer" });
  const ofRevoked = await screenshotToken(image, { grant: revoked.id });
  await getTestDb().oAuthGrant.delete({ where: { id: revoked.id } });
  const download = await signFileLinkToken({ grant: grantId, version: manual.versions[0]?.id ?? "" });

  const answers = [];
  for (const [what, token] of [
    ["expired", expired],
    ["forged", forged],
    ["revoked", ofRevoked],
    ["download token", download],
  ] as const) {
    const response = await post(request, "guides/screenshot.png", `?token=${token}`, image);
    answers.push({ what, status: response.status(), body: await response.text() });
  }
  const [first] = answers;
  expect(first?.status).toBe(404);
  for (const answer of answers)
    expect({ status: answer.status, body: answer.body }, answer.what).toEqual({
      status: first?.status,
      body: first?.body,
    });
  expect(await getTestDb().file.count({ where: { name: "screenshot.png" } })).toBe(0);

  // An upload token sent to the file address downloads nothing.
  const asDownload = await request.get(`/files/projects/guides/screenshot.png?token=${valid}`, { maxRedirects: 0 });
  expect(asDownload.status()).toBe(404);
  const manualUpload = await signUploadLinkToken({ grant: grantId, name: "manual.pdf", size: 10 });
  expect((await request.get(`/files/projects/manual.pdf?token=${manualUpload}`, { maxRedirects: 0 })).status()).toBe(
    404,
  );
});

test("an upload by link changes no page, and leaves the MCP budget of the user and the last use of the app alone", async ({
  request,
  page,
}) => {
  const overview = await createPage({ folder: projects, name: "overview", content: "# Overview\n\nThe screenshot." });
  // The budget of the user is spent by calls of the Reader connection.
  let answer = await send(request, { method: "tools/list" });
  for (let calls = 0; answer.status() === 200 && calls < 1000; calls += 1) {
    answer = await send(request, { method: "tools/list" });
  }
  expect(answer.status()).toBe(429);

  const image = await pngBytes();
  const response = await post(request, "guides/screenshot.png", `?token=${await screenshotToken(image)}`, image);

  expect(response.status()).toBe(201);
  expect(await getTestDb().pageRevision.count({ where: { pageId: overview.id } })).toBe(1);
  expect((await getTestDb().oAuthGrant.findUniqueOrThrow({ where: { id: grantId } })).lastUsedAt).toBeNull();
  await logIn(page, owner.username);
  await expect(page).toHaveURL("/folders");
  await page.goto("/account");
  const grant = await getTestDb().oAuthGrant.findUniqueOrThrow({ where: { id: grantId } });
  await expect(page.getByRole("listitem").filter({ hasText: grant.name })).toContainText("Last used never");
});
