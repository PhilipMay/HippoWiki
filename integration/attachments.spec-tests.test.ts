// Tests written from the spec of attachments alone (`spec/attachments.md`), for the rules or the
// parts of rules that the other tests of the files service leave open: a PDF is stored as uploaded, also with the
// removal of the metadata of photos switched on.
import { beforeEach, describe, expect, it } from "vitest";

import { inBrowser, type BrowserActor } from "@/features/folder-roles/actors";
import * as fileService from "@/features/files/service";

import { createFolder, createUser } from "../e2e/support/database";
import { pdfBytes } from "../e2e/support/files";
import { KNOWN_USER } from "../prisma/known-users";

/** The user who uploads, the known user `alice`, Owner of every folder a test creates without roles. */
let actor: BrowserActor;

beforeEach(async () => {
  actor = inBrowser(await createUser({ id: KNOWN_USER.id, name: "alice" }));
});

describe("the metadata of an upload", () => {
  // attachments.md, "Images": a PDF is stored as uploaded; the removal of the metadata is for
  // photos only.
  it("stores a PDF byte for byte, also with the removal of the metadata switched on", async () => {
    const folder = await createFolder({ name: "handbook" });
    const bytes = Buffer.concat([
      pdfBytes("the manual"),
      Buffer.from("% /Author (Somebody) /CreationDate (D:20260101120000Z) /Producer (Scanner)\n", "latin1"),
    ]);

    const result = await fileService.uploadFile(actor, { folderId: folder.id, tabId: null }, "manual.pdf", [bytes], {
      contentLength: bytes.length,
      stripMetadata: true,
      replace: null,
      size: null,
      fileId: null,
    });

    expect(result).toMatchObject({ ok: true, value: { name: "manual.pdf", type: "pdf" } });
    const content = await fileService.getFileContent(actor, "handbook", null, "manual.pdf", null);
    expect(content?.version.size).toBe(bytes.length);
    expect(Buffer.from(await new Response(content?.blob.stream).arrayBuffer())).toEqual(bytes);
  });
});
