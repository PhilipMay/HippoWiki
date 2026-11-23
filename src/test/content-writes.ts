// The table of all content writes, for the unit tests of the services of pages, folders and files: a new write is added here
// once, and every table of those tests that goes over the writes (the actor of a write, an admin, no role, the lowest
// role of each function) picks it up. It imports the services, so a test imports it after its `vi.mock` calls, as
// every static import is. It is no test itself and is left out of the coverage (`vitest.config.ts`).
import type { BrowserActor } from "@/features/folder-roles/actors";
import type { Role } from "@/features/folder-roles/roles";
import * as files from "@/features/files/service";
import * as folders from "@/features/folders/service";
import * as pages from "@/features/pages/service";

import { FILE_ID, FOLDER_ID, PAGE_ID, TAB_ID } from "./unit";

/** A content write of the pages, the folders or the files service. */
export type ContentWrite = {
  /** The function of the service. */
  name: string;
  /** The service the write belongs to. */
  service: "pages" | "folders" | "files";
  /** The write with valid input, by the given actor. */
  call: (actor: BrowserActor) => Promise<unknown>;
  /** The lowest role that may make the write; `null` for a write that needs no role, such as creating a folder. */
  lowest: Role | null;
  /** The ids that the log line of a refusal for the role names. */
  target: Record<string, string>;
  /** The start of the log lines of a refusal, such as "page not created". */
  what: string;
  /** The foreign key of the last editor that the write stores, which a missing actor violates. */
  editorKey: string;
  /** The log message of a failed write, such as "failed to create page"; also for a lookup that fails before it. */
  failure: string;
};

/** The content of a valid page, whose derived title is "My page". */
export const CONTENT = "# My page\n\nText";

const CONTENT_WRITES: readonly ContentWrite[] = [
  {
    name: "createPage",
    service: "pages",
    call: (actor) => pages.createPage(actor, FOLDER_ID, { name: "my-page", content: CONTENT, tabId: TAB_ID }),
    lowest: "writer",
    target: { folderId: FOLDER_ID },
    what: "page not created",
    editorKey: "Page_lastEditedById_fkey",
    failure: "failed to create page",
  },
  {
    name: "updatePageContent",
    service: "pages",
    call: (actor) => pages.updatePageContent(actor, PAGE_ID, { content: CONTENT, version: 1 }),
    lowest: "writer",
    target: { pageId: PAGE_ID },
    what: "page not saved",
    editorKey: "Page_lastEditedById_fkey",
    failure: "failed to update page",
  },
  {
    name: "moveOrRenamePage",
    service: "pages",
    call: (actor) => pages.moveOrRenamePage(actor, PAGE_ID, { name: "new-name", tabId: TAB_ID, version: 1 }),
    lowest: "writer",
    target: { pageId: PAGE_ID },
    what: "page not moved or renamed",
    editorKey: "Page_lastEditedById_fkey",
    failure: "failed to move or rename page",
  },
  {
    name: "deletePage",
    service: "pages",
    call: (actor) => pages.deletePage(actor, PAGE_ID, { version: 1 }),
    lowest: "manager",
    target: { pageId: PAGE_ID },
    what: "page not deleted",
    editorKey: "Page_lastEditedById_fkey",
    failure: "failed to delete page",
  },
  {
    name: "restorePage",
    service: "pages",
    call: (actor) => pages.restorePage(actor, PAGE_ID, { name: "new-name", tabId: TAB_ID }),
    lowest: "manager",
    target: { pageId: PAGE_ID },
    what: "page not restored",
    editorKey: "Page_lastEditedById_fkey",
    failure: "failed to restore page",
  },
  {
    name: "revertPage",
    service: "pages",
    call: (actor) => pages.revertPage(actor, PAGE_ID, { revision: 2, version: 1 }),
    lowest: "writer",
    target: { pageId: PAGE_ID },
    what: "page not reverted",
    editorKey: "Page_lastEditedById_fkey",
    failure: "failed to revert page",
  },
  {
    name: "createFolder",
    service: "folders",
    call: (actor) => folders.createFolder(actor, { name: " handbook " }),
    lowest: null,
    target: {},
    what: "folder not created",
    editorKey: "Folder_lastEditedById_fkey",
    failure: "failed to create folder",
  },
  {
    name: "renameFolder",
    service: "folders",
    call: (actor) => folders.renameFolder(actor, FOLDER_ID, { name: " handbook " }),
    lowest: "owner",
    target: { folderId: FOLDER_ID },
    what: "folder not renamed",
    editorKey: "Folder_lastEditedById_fkey",
    failure: "failed to rename folder",
  },
  {
    name: "createTab",
    service: "folders",
    call: (actor) => folders.createTab(actor, FOLDER_ID, { name: " guides " }),
    lowest: "manager",
    target: { folderId: FOLDER_ID },
    what: "tab not created",
    editorKey: "Tab_lastEditedById_fkey",
    failure: "failed to create tab",
  },
  {
    name: "renameTab",
    service: "folders",
    call: (actor) => folders.renameTab(actor, TAB_ID, { name: " guides " }),
    lowest: "manager",
    target: { tabId: TAB_ID },
    what: "tab not renamed",
    editorKey: "Tab_lastEditedById_fkey",
    failure: "failed to rename tab",
  },
  {
    name: "deleteTab",
    service: "folders",
    call: (actor) => folders.deleteTab(actor, FOLDER_ID, TAB_ID),
    lowest: "manager",
    target: { folderId: FOLDER_ID, tabId: TAB_ID },
    what: "tab not deleted",
    editorKey: "Page_lastEditedById_fkey",
    failure: "failed to delete tab",
  },
  {
    name: "uploadFile",
    service: "files",
    call: (actor) =>
      files.uploadFile(actor, { folderId: FOLDER_ID, tabId: TAB_ID }, "diagram.png", [], {
        contentLength: null,
        stripMetadata: true,
        replace: null,
        size: null,
        fileId: null,
      }),
    lowest: "writer",
    target: { folderId: FOLDER_ID, tabId: TAB_ID },
    what: "file not uploaded",
    editorKey: "File_lastEditedById_fkey",
    failure: "failed to upload file",
  },
  {
    name: "revertFile",
    service: "files",
    call: (actor) => files.revertFile(actor, FILE_ID, { version: 1, lockVersion: 3 }),
    lowest: "writer",
    target: { fileId: FILE_ID },
    what: "file not reverted",
    editorKey: "FileVersion_userId_fkey",
    failure: "failed to revert file",
  },
  {
    name: "moveOrRenameFile",
    service: "files",
    call: (actor) => files.moveOrRenameFile(actor, FILE_ID, { name: "network.png", tabId: null, lockVersion: 3 }),
    lowest: "writer",
    target: { fileId: FILE_ID },
    what: "file not moved or renamed",
    editorKey: "File_lastEditedById_fkey",
    failure: "failed to move or rename file",
  },
  {
    name: "deleteFile",
    service: "files",
    call: (actor) => files.deleteFile(actor, FILE_ID, { lockVersion: 3 }),
    lowest: "manager",
    target: { fileId: FILE_ID },
    what: "file not deleted",
    editorKey: "File_lastEditedById_fkey",
    failure: "failed to delete file",
  },
  {
    name: "restoreFile",
    service: "files",
    call: (actor) => files.restoreFile(actor, FILE_ID, { name: "diagram.png", tabId: null }),
    lowest: "manager",
    target: { fileId: FILE_ID },
    what: "file not restored",
    editorKey: "File_lastEditedById_fkey",
    failure: "failed to restore file",
  },
];

/** The content writes of the given service. */
export function contentWritesOf(service: ContentWrite["service"]): readonly ContentWrite[] {
  return CONTENT_WRITES.filter((write) => write.service === service);
}

/** The roles from the lowest up. */
export const ROLES = ["reader", "writer", "manager", "owner"] as const satisfies readonly Role[];

/** Whether the given role may make the write. */
export function allows(write: ContentWrite, role: Role): boolean {
  return write.lowest === null || ROLES.indexOf(role) >= ROLES.indexOf(write.lowest);
}
