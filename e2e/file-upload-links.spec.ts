// The upload of a file by a signed upload link, as an AI app makes it with `curl`: a `POST` of the bytes of the file to
// the upload address with the token of the link as its only query, without a session cookie. The links are signed by
// `signUploadLinkToken()` with the key of the database of the worker, as the server signs them, also to make one that
// has expired or is broken. The scenarios "through MCP" get their links from the tool `get_file_upload_link`.
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { APIRequestContext, APIResponse } from "@playwright/test";

import { LOCAL_FILE_PLACEHOLDER } from "@/features/mcp/tool-schemas";

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
import { pdfBytes, pngBytes, uploadFile } from "./support/files";
import { callTool, mcpPath, send, setUpProjects } from "./support/mcp";
import { expect, test } from "./support/test";

/** Runs a program and gives its output, as a shell of an agent runs the curl command of a tool result. */
const run = promisify(execFile);

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
    // The query with which the browser keeps the metadata of an image.
    `?token=${token}&strip=0`,
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

test.describe("through MCP", () => {
  /** Sends the file at the path with the curl command of a result of get_file_upload_link, in a shell. */
  async function runCurl(curlCommand: string, path: string): Promise<{ status: number; body: unknown }> {
    expect(curlCommand).toContain(LOCAL_FILE_PLACEHOLDER);
    const command = `${curlCommand.replace(LOCAL_FILE_PLACEHOLDER, path)} --silent --show-error --write-out '\\n%{http_code}'`;
    const { stdout } = await run("sh", ["-c", command]).catch((err: { stdout?: string }) => ({
      stdout: err.stdout ?? "",
    }));
    const lines = stdout.trimEnd().split("\n");
    const status = Number(lines.pop());
    return { status, body: JSON.parse(lines.join("\n")) as unknown };
  }

  test("a new screenshot: a Writer connection gets a link, sends the image with curl and shows it in a page", async ({
    request,
    page,
  }, testInfo) => {
    const { accessToken: writer } = await createGrant({ owner, folder: projects, role: "writer" });
    const writerConnection = { address: mcpPath(projects, "writer"), token: writer };
    await createPage({ folder: projects, tab: guides, name: "setup", content: "# Setup\n\nOpen the settings." });
    const image = await pngBytes(64, 48);
    const path = testInfo.outputPath("settings-dialog.png");
    await writeFile(path, image);

    const result = await callTool(request, writerConnection, "get_file_upload_link", {
      tab: "guides",
      file: "settings-dialog.png",
      size: image.length,
    });
    expect(result.isError).toBeFalsy();
    const link = result.structuredContent as Record<string, string>;
    expect(Object.keys(link)).toEqual([
      "note",
      "name",
      "tab",
      "type",
      "size",
      "uploadLink",
      "expiresAt",
      "curlCommand",
      "wikiLink",
      "embedLink",
    ]);
    expect(link.uploadLink).toMatch(/\/api\/uploads\/projects\/guides\/settings-dialog\.png\?token=[^&]+$/);

    const sent = await runCurl(link.curlCommand ?? "", path);
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ ok: true, name: "settings-dialog.png", tab: "guides", width: 64, height: 48 });

    // The wiki link and the embed link are those that read_file gives for the stored file.
    const read = await callTool(request, writerConnection, "read_file", { tab: "guides", file: "settings-dialog.png" });
    expect(read.structuredContent).toMatchObject({
      wikiLink: link.wikiLink,
      embedLink: link.embedLink,
      lastEditedBy: owner.username,
      lastEditedVia: "mcp",
    });
    const pageRead = await callTool(request, writerConnection, "read_page", { tab: "guides", page: "setup" });
    const { version } = pageRead.structuredContent as { version: number };
    const edited = await callTool(request, writerConnection, "edit_page_content", {
      tab: "guides",
      page: "setup",
      version,
      edits: [{ oldText: "Open the settings.", newText: `Open the settings.\n\n${link.embedLink}` }],
    });
    expect(edited.isError).toBeFalsy();

    await logIn(page, owner.username);
    await expect(page).toHaveURL("/folders");
    await page.goto("/folders/projects/guides/setup.md");
    const shown = page.getByRole("article").getByRole("img", { name: "settings-dialog.png" });
    await expect(shown).toHaveAttribute("src", "/files/projects/guides/settings-dialog.png");
    await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
    await page.goto("/folders/projects/guides/settings-dialog.png");
    const versions = page.getByRole("table", { name: "Versions" });
    await expect(versions.getByRole("row").nth(1)).toContainText(owner.username);
    await expect(versions.getByRole("row").nth(1)).toContainText("mcp");
  });

  test("a new version: a Manager connection reads a PDF, gets a link with its lock version and sends the file", async ({
    request,
    page,
  }) => {
    const { accessToken: manager } = await createGrant({ owner, folder: projects, role: "manager" });
    const managerConnection = { address: mcpPath(projects, "manager"), token: manager };

    const read = await callTool(request, managerConnection, "read_file", { file: "manual.pdf" });
    const { lockVersion } = read.structuredContent as { lockVersion: number };
    const second = pdfBytes("The exported architecture");
    const result = await callTool(request, managerConnection, "get_file_upload_link", {
      file: "manual.pdf",
      size: second.length,
      lockVersion,
    });
    expect(result.isError).toBeFalsy();
    const { uploadLink, embedLink } = result.structuredContent as { uploadLink: string; embedLink: string | null };
    expect(embedLink).toBeNull();

    const response = await request.post(uploadLink, {
      data: second,
      headers: { "content-type": "application/octet-stream" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, name: "manual.pdf", version: 2 });

    const after = await callTool(request, managerConnection, "read_file", { file: "manual.pdf" });
    expect(after.structuredContent).toMatchObject({ versions: 2, lockVersion: lockVersion + 1, size: second.length });
    await logIn(page, owner.username);
    await expect(page).toHaveURL("/folders");
    await page.goto("/folders/projects/manual.pdf");
    await expect(page.getByRole("table", { name: "Versions" }).getByRole("link", { name: /^Version/ })).toHaveText([
      "Version 2",
      "Version 1",
    ]);
    expect(await (await page.request.get("/files/projects/manual.pdf")).body()).toEqual(second);
    expect(await (await page.request.get("/files/projects/manual.pdf?version=1")).body()).toEqual(pdfBytes());
  });

  test("a change at the same time: a version uploaded in the browser after the link makes the upload by link fail", async ({
    request,
    page,
  }) => {
    const { accessToken: writer } = await createGrant({ owner, folder: projects, role: "writer" });
    const writerConnection = { address: mcpPath(projects, "writer"), token: writer };
    const read = await callTool(request, writerConnection, "read_file", { file: "manual.pdf" });
    const { lockVersion } = read.structuredContent as { lockVersion: number };
    const byAgent = pdfBytes("The version of the agent");
    const result = await callTool(request, writerConnection, "get_file_upload_link", {
      file: "manual.pdf",
      size: byAgent.length,
      lockVersion,
    });
    const { uploadLink } = result.structuredContent as { uploadLink: string };

    await logIn(page, owner.username);
    await expect(page).toHaveURL("/folders");
    const byPerson = pdfBytes("The version of the person");
    const browserUpload = await uploadFile(page, {
      folder: "projects",
      name: "manual.pdf",
      bytes: byPerson,
      replace: lockVersion,
    });
    expect(browserUpload.status()).toBe(201);

    const response = await request.post(uploadLink, {
      data: byAgent,
      headers: { "content-type": "application/octet-stream" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(409);
    const answer = (await response.json()) as { ok: boolean; code: string; message: string };
    expect(answer).toMatchObject({ ok: false, code: "file-changed" });
    expect(answer.message).toContain("The file was changed");

    const after = await callTool(request, writerConnection, "read_file", { file: "manual.pdf" });
    expect(after.structuredContent).toMatchObject({ versions: 2, lockVersion: lockVersion + 1, lastEditedVia: "web" });
    expect(await (await page.request.get("/files/projects/manual.pdf")).body()).toEqual(byPerson);
  });
});
