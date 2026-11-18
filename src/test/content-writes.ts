// The table of all content writes, for the unit tests of the services of pages and folders: a new write is added here
// once, and every table of those tests that goes over the writes (the actor of a write, an admin, no role, the lowest
// role of each function) picks it up. It imports the services, so a test imports it after its `vi.mock` calls, as
// every static import is. It is no test itself and is left out of the coverage (`vitest.config.ts`).
import type { BrowserActor } from "@/features/folder-roles/service";
import type { Role } from "@/features/folder-roles/roles";
import * as folders from "@/features/folders/service";
import * as pages from "@/features/pages/service";

import { FOLDER_ID, PAGE_ID, TAB_ID } from "./unit";

/** A content write of the pages or the folders service. */
export type ContentWrite = {
  /** The function of the service. */
  name: string;
  /** The service the write belongs to. */
  service: "pages" | "folders";
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
};

/** The content of a valid page, whose derived title is "My page". */
export const CONTENT = "# My page\n\nText";

export const CONTENT_WRITES: readonly ContentWrite[] = [
  {
    name: "createPage",
    service: "pages",
    call: (actor) => pages.createPage(actor, FOLDER_ID, { name: "my-page", content: CONTENT, tabId: TAB_ID }),
    lowest: "writer",
    target: { folderId: FOLDER_ID },
    what: "page not created",
    editorKey: "Page_lastEditedById_fkey",
  },
  {
    name: "updatePageContent",
    service: "pages",
    call: (actor) => pages.updatePageContent(actor, PAGE_ID, { content: CONTENT, version: 1 }),
    lowest: "writer",
    target: { pageId: PAGE_ID },
    what: "page not saved",
    editorKey: "Page_lastEditedById_fkey",
  },
  {
    name: "moveOrRenamePage",
    service: "pages",
    call: (actor) => pages.moveOrRenamePage(actor, PAGE_ID, { name: "new-name", tabId: TAB_ID, version: 1 }),
    lowest: "writer",
    target: { pageId: PAGE_ID },
    what: "page not moved or renamed",
    editorKey: "Page_lastEditedById_fkey",
  },
  {
    name: "deletePage",
    service: "pages",
    call: (actor) => pages.deletePage(actor, PAGE_ID, { version: 1 }),
    lowest: "manager",
    target: { pageId: PAGE_ID },
    what: "page not deleted",
    editorKey: "Page_lastEditedById_fkey",
  },
  {
    name: "restorePage",
    service: "pages",
    call: (actor) => pages.restorePage(actor, PAGE_ID, { name: "new-name", tabId: TAB_ID }),
    lowest: "manager",
    target: { pageId: PAGE_ID },
    what: "page not restored",
    editorKey: "Page_lastEditedById_fkey",
  },
  {
    name: "revertPage",
    service: "pages",
    call: (actor) => pages.revertPage(actor, PAGE_ID, { revision: 2, version: 1 }),
    lowest: "writer",
    target: { pageId: PAGE_ID },
    what: "page not reverted",
    editorKey: "Page_lastEditedById_fkey",
  },
  {
    name: "createFolder",
    service: "folders",
    call: (actor) => folders.createFolder(actor, { name: " handbook " }),
    lowest: null,
    target: {},
    what: "folder not created",
    editorKey: "Folder_lastEditedById_fkey",
  },
  {
    name: "renameFolder",
    service: "folders",
    call: (actor) => folders.renameFolder(actor, FOLDER_ID, { name: " handbook " }),
    lowest: "owner",
    target: { folderId: FOLDER_ID },
    what: "folder not renamed",
    editorKey: "Folder_lastEditedById_fkey",
  },
  {
    name: "createTab",
    service: "folders",
    call: (actor) => folders.createTab(actor, FOLDER_ID, { name: " guides " }),
    lowest: "manager",
    target: { folderId: FOLDER_ID },
    what: "tab not created",
    editorKey: "Tab_lastEditedById_fkey",
  },
  {
    name: "renameTab",
    service: "folders",
    call: (actor) => folders.renameTab(actor, TAB_ID, { name: " guides " }),
    lowest: "manager",
    target: { tabId: TAB_ID },
    what: "tab not renamed",
    editorKey: "Tab_lastEditedById_fkey",
  },
  {
    name: "deleteTab",
    service: "folders",
    call: (actor) => folders.deleteTab(actor, FOLDER_ID, TAB_ID),
    lowest: "manager",
    target: { folderId: FOLDER_ID, tabId: TAB_ID },
    what: "tab not deleted",
    editorKey: "Page_lastEditedById_fkey",
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
