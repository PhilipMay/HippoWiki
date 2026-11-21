import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getFileContent: vi.fn(),
  uploadFile: vi.fn(),
  getFolderByName: vi.fn(),
  getTab: vi.fn(),
  revalidateContent: vi.fn(),
  publicUrl: undefined as string | undefined,
}));

vi.mock("next/navigation", async () => {
  const { NotFoundError } = await import("@/test/unit");
  return {
    notFound: () => {
      throw new NotFoundError();
    },
  };
});
vi.mock("@/features/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/features/files/service", () => ({ getFileContent: mocks.getFileContent, uploadFile: mocks.uploadFile }));
vi.mock("@/features/folders/service", () => ({ getFolderByName: mocks.getFolderByName, getTab: mocks.getTab }));
vi.mock("@/lib/revalidate", () => ({ revalidateContent: mocks.revalidateContent }));
vi.mock("@/lib/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  getServerEnv: () => ({ HIPPOWIKI_PUBLIC_URL: mocks.publicUrl }),
}));

import { handleFileRequest, handleUploadRequest } from "@/features/files/http";
import { ACTOR_ID, FOLDER_ID, NotFoundError, TAB_ID } from "@/test/unit";

const USER = { id: ACTOR_ID, name: "alice", type: "user", mustChangePassword: false };
const SHA = "c".repeat(64);
const BYTES = new Uint8Array([1, 2, 3, 4]);

/** The content of a file as the service returns it, with a stream of the bytes. */
function content(type = "png", name = "diagram.png") {
  return {
    name,
    type,
    version: { number: 2, sha256: SHA, size: BYTES.length },
    blob: { size: BYTES.length, stream: new Response(BYTES).body },
  };
}

/** A request of the file address with the query, the method and the headers. */
function fileRequest(query = "", method = "GET", headers: Record<string, string> = {}): Request {
  return new Request(`http://wiki.test/files/handbook/guides/diagram.png${query}`, { method, headers });
}

const SEGMENTS = { folder: "handbook", path: ["guides", "diagram.png"] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.publicUrl = undefined;
  mocks.getCurrentUser.mockResolvedValue(USER);
  mocks.getFileContent.mockResolvedValue(content());
  mocks.getFolderByName.mockResolvedValue({ id: FOLDER_ID, name: "handbook", role: "writer" });
  mocks.getTab.mockResolvedValue({ id: TAB_ID, name: "guides", folder: { id: FOLDER_ID, name: "handbook" } });
});

describe("handleFileRequest", () => {
  it("sends the content with its type, its name inline, no-cache and the SHA-256 as ETag", async () => {
    const response = await handleFileRequest(fileRequest(), SEGMENTS);

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "private, no-cache",
      "content-disposition": 'inline; filename="diagram.png"',
      "content-length": "4",
      "content-type": "image/png",
      etag: `"${SHA}"`,
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
    expect(mocks.getFileContent).toHaveBeenCalledWith(
      { id: ACTOR_ID, name: "alice", type: "user", channel: "web" },
      "handbook",
      "guides",
      "diagram.png",
      null,
    );
  });

  it("sends a PDF with its type, a version of it, and a download as an attachment", async () => {
    mocks.getFileContent.mockResolvedValue(content("pdf", "manual.pdf"));

    const response = await handleFileRequest(fileRequest("?version=1&download"), {
      folder: "handbook",
      path: ["manual.pdf"],
    });

    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="manual.pdf"');
    expect(mocks.getFileContent).toHaveBeenCalledWith(expect.anything(), "handbook", null, "manual.pdf", 1);
  });

  it("answers a matching If-None-Match with 304 and no content", async () => {
    for (const header of [`"${SHA}"`, `W/"${SHA}"`, `"other", "${SHA}"`, "*"]) {
      mocks.getFileContent.mockResolvedValueOnce(content());
      const response = await handleFileRequest(fileRequest("", "GET", { "if-none-match": header }), SEGMENTS);

      expect(response.status, header).toBe(304);
      expect(response.headers.get("etag")).toBe(`"${SHA}"`);
      expect(response.headers.get("content-type")).toBeNull();
      expect(await response.text()).toBe("");
    }
  });

  it("sends the content again for an entity tag that does not match", async () => {
    const response = await handleFileRequest(fileRequest("", "GET", { "if-none-match": '"other"' }), SEGMENTS);

    expect(response.status).toBe(200);
  });

  it("answers HEAD with the headers and no content", async () => {
    const response = await handleFileRequest(fileRequest("", "HEAD"), SEGMENTS);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("4");
    expect(await response.text()).toBe("");
  });

  it.each([
    ["no session", () => mocks.getCurrentUser.mockResolvedValue(null)],
    [
      "a user who still has the first password",
      () => mocks.getCurrentUser.mockResolvedValue({ ...USER, mustChangePassword: true }),
    ],
    [
      "a file the service does not return: no role, an admin, missing, deleted or files off",
      () => mocks.getFileContent.mockResolvedValue(null),
    ],
  ])("shows the not-found page for %s", async (_what, arrange) => {
    arrange();

    await expect(handleFileRequest(fileRequest(), SEGMENTS)).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each([
    "?v=1",
    "?version=0",
    "?version=01",
    "?version=a",
    "?version=1&version=2",
    "?download=1",
    "?download&download",
    "?version",
  ])("shows the not-found page for the query %s without reading the file", async (query) => {
    await expect(handleFileRequest(fileRequest(query), SEGMENTS)).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.getFileContent).not.toHaveBeenCalled();
  });

  it("shows the not-found page for an address with more segments", async () => {
    await expect(
      handleFileRequest(fileRequest(), { folder: "handbook", path: ["guides", "more", "diagram.png"] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.getFileContent).not.toHaveBeenCalled();
  });
});

/** A request of the upload address with the query and the headers, from the own origin by default. */
function uploadRequest(query = "", headers: Record<string, string> = {}): Request {
  return new Request(`http://wiki.test/api/uploads/handbook/guides/diagram.png${query}`, {
    method: "POST",
    body: BYTES,
    headers: { host: "wiki.test", origin: "http://wiki.test", "sec-fetch-site": "same-origin", ...headers },
  });
}

const STORED = {
  id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002",
  name: "diagram.png",
  type: "png",
  lockVersion: 4,
  updatedAt: new Date("2026-11-20T10:00:00Z"),
  lastEditedBy: { name: "bob", via: "web" },
  folder: { name: "handbook" },
  tab: { name: "guides" },
};

describe("handleUploadRequest", () => {
  it("stores the body as the file of the address and answers with its details page", async () => {
    mocks.uploadFile.mockResolvedValue({ ok: true, value: STORED });

    const response = await handleUploadRequest(uploadRequest("", { "content-length": "4" }), SEGMENTS);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, address: "/folders/handbook/guides/diagram.png" });
    expect(mocks.revalidateContent).toHaveBeenCalled();
    const [actor, place, name, body, options] = mocks.uploadFile.mock.calls[0] as unknown[];
    expect([actor, place, name, options]).toEqual([
      { id: ACTOR_ID, name: "alice", type: "user", channel: "web" },
      { folderId: FOLDER_ID, tabId: TAB_ID },
      "diagram.png",
      { contentLength: 4, stripMetadata: true, replace: null },
    ]);
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(BYTES);
  });

  it("keeps the metadata with strip=0 and states the lock version of a new version", async () => {
    mocks.uploadFile.mockResolvedValue({ ok: true, value: STORED });

    await handleUploadRequest(uploadRequest("?strip=0&replace=3"), { folder: "handbook", path: ["diagram.png"] });

    expect(mocks.getTab).not.toHaveBeenCalled();
    expect(mocks.uploadFile.mock.calls[0]?.[1]).toEqual({ folderId: FOLDER_ID, tabId: null });
    expect(mocks.uploadFile.mock.calls[0]?.[4]).toEqual({ contentLength: null, stripMetadata: false, replace: 3 });
  });

  it("accepts the origin of the public URL behind a reverse proxy", async () => {
    mocks.publicUrl = "https://wiki.example.com";
    mocks.uploadFile.mockResolvedValue({ ok: true, value: STORED });

    const response = await handleUploadRequest(
      uploadRequest("", { host: "localhost:3000", origin: "https://wiki.example.com" }),
      SEGMENTS,
    );

    expect(response.status).toBe(201);
  });

  it.each([
    ["no Origin", { origin: "" }],
    ["another Origin", { origin: "https://evil.example" }],
    ["an Origin of another port", { origin: "http://wiki.test:8080" }],
    ["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
    ["a malformed Origin", { origin: "not a url" }],
  ])("shows the not-found page for an upload with %s, before it looks at the session", async (_what, headers) => {
    const request = uploadRequest("", headers);
    if ((headers as Record<string, string>).origin === "") request.headers.delete("origin");

    await expect(handleUploadRequest(request, SEGMENTS)).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it.each([
    ["no session", () => mocks.getCurrentUser.mockResolvedValue(null)],
    [
      "a user who still has the first password",
      () => mocks.getCurrentUser.mockResolvedValue({ ...USER, mustChangePassword: true }),
    ],
    ["a folder the user has no role on", () => mocks.getFolderByName.mockResolvedValue(null)],
    [
      "a user the service does not allow it",
      () => mocks.uploadFile.mockResolvedValue({ ok: false, error: { code: "not-allowed" } }),
    ],
  ])("shows the not-found page for %s", async (_what, arrange) => {
    arrange();

    await expect(handleUploadRequest(uploadRequest(), SEGMENTS)).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.revalidateContent).not.toHaveBeenCalled();
  });

  it.each(["?strip=1", "?strip", "?replace=0", "?replace=x", "?replace=1&replace=2", "?other=1"])(
    "shows the not-found page for the query %s",
    async (query) => {
      await expect(handleUploadRequest(uploadRequest(query), SEGMENTS)).rejects.toBeInstanceOf(NotFoundError);
      expect(mocks.uploadFile).not.toHaveBeenCalled();
    },
  );

  it("answers a missing tab as JSON", async () => {
    mocks.getTab.mockResolvedValue(null);

    const response = await handleUploadRequest(uploadRequest(), SEGMENTS);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, code: "tab-not-found", field: null });
  });

  const FILE_STATE = {
    lockVersion: 4,
    updatedAt: "2026-11-20T10:00:00.000Z",
    lastEditedBy: { name: "bob", via: "web" },
  };

  it.each([
    [{ code: "folder-not-found" }, 404, null, "This folder no longer exists."],
    [{ code: "tab-not-found" }, 404, null, "This tab no longer exists."],
    [{ code: "invalid-input", fieldErrors: { name: ["Use lowercase…"] } }, 400, "name", "Use lowercase…"],
    [{ code: "file-not-found" }, 404, null, "This file no longer exists."],
    [{ code: "files-off" }, 503, null, "Files cannot be uploaded: the server has no place to keep them."],
    [
      { code: "wrong-type", detected: null, expected: "png" },
      415,
      "file",
      "Only PNG, JPEG, GIF, WebP and PDF files can be uploaded.",
    ],
    [
      { code: "wrong-type", detected: "pdf", expected: "png" },
      415,
      "file",
      "The file is a PDF, but the name ends in .png: use a name that ends in .pdf.",
    ],
    [{ code: "too-large", limit: 26_214_400 }, 413, "file", "The file is larger than 25 MiB, the limit."],
    [{ code: "disk-full" }, 507, "file", "The file does not fit on the disk of the server. Nothing was stored."],
    [{ code: "invalid-image", reason: "unreadable" }, 422, "file", "The image could not be read. It may be damaged."],
    [
      { code: "invalid-image", reason: "too-many-pixels" },
      422,
      "file",
      "The image has more than 100 megapixels, the limit.",
    ],
    [{ code: "failed" }, 500, null, "The file could not be uploaded. Please try again."],
  ])("answers %j with its status, field and message", async (error, status, field, message) => {
    mocks.uploadFile.mockResolvedValue({ ok: false, error });

    const response = await handleUploadRequest(uploadRequest(), SEGMENTS);

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, code: error.code, field, message });
    expect(mocks.revalidateContent).not.toHaveBeenCalled();
  });

  it.each([
    ["name-taken", "name", "A file of this name exists here already."],
    ["file-changed", null, "The file was changed after you opened this dialog."],
  ])("answers %s with the file as it is now", async (code, field, message) => {
    mocks.uploadFile.mockResolvedValue({ ok: false, error: { code, file: STORED } });

    const response = await handleUploadRequest(uploadRequest(), SEGMENTS);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, code, field, message, file: FILE_STATE });
  });
});
