// What a form that rests on the version of a page needs after a change that was refused as `page-changed` (see
// `optimistic-locking.md`): the message of the notice `changed` and the key that starts the form anew. The page view
// and the page address use it for the editor and the dialogs alike, and the dialogs of files the message, with the
// lock version of the file. No server-only imports.

import type { PageWithPlace } from "@/features/pages/service";
import { editorWithChannel } from "@/features/users/records";
import type { PageNotice } from "@/lib/addresses";
import { formatDateTime } from "@/lib/format";

type ChangedPage = Pick<PageWithPlace, "version" | "updatedAt" | "lastEditedBy">;

/**
 * The message of the notice `changed`: who changed the page or file last, how and when, as their views show them. The
 * editor or dialog shows it after a change was refused, because the item was changed after it was opened.
 */
export function changedMessage(
  item: { updatedAt: Date; lastEditedBy: ChangedPage["lastEditedBy"] },
  what: "page" | "file" = "page",
): string {
  return `This ${what} was changed by ${editorWithChannel(item.lastEditedBy)} at ${formatDateTime(item.updatedAt)} after you opened it.`;
}

/**
 * The key and the message of a form that rests on the version of the page, for the notice of its address. A new key
 * after a refused change starts the editor or dialog anew with the page as stored, instead of keeping the input of the
 * user: the version changes with every change of the page, the notice when no version was submitted. The message is
 * there only with the notice `changed`.
 */
export function changedPageForm(
  page: ChangedPage,
  notice: PageNotice | null,
): { key: string; changedMessage: string | undefined } {
  return {
    key: `${page.version}-${notice ?? ""}`,
    changedMessage: notice === "changed" ? changedMessage(page) : undefined,
  };
}
