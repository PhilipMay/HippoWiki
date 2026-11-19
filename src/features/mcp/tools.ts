// The handlers of the MCP tools: what an AI app can do with the folder of its connection. They follow the rules of the
// browser, the version check of optimistic locking included, and call the services of the folders and pages with the
// actor of MCP, which carries the connection: the services give it only the folder of the connection, with the lower
// of the user's role and the role of the connection, as `queries.ts` does with the channel `web` for the GUI. Which
// tools a connection gets, and how a client sees them, is `server.ts`; their inputs and outputs are `tool-schemas.ts`.
// The tools know nothing about HTTP, tokens or Next.js: the adapter in `http.ts` finds out who is calling, and with
// which connection, before a tool runs. No import of `next` or `react`, so the tools load wherever the services load.

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { z } from "zod";

import { mayDo } from "@/features/folder-roles/roles";
import type { McpActor } from "@/features/folder-roles/actors";
import * as folderService from "@/features/folders/service";
import type {
  createPageInput,
  createTabInput,
  deletedPageOutput,
  deletedTabOutput,
  deletePageInput,
  deleteTabInput,
  editedPageOutput,
  editPageContentInput,
  listFolderOutput,
  moveOrRenamePageInput,
  readPageInput,
  readPageOutput,
  renameTabInput,
  replacePageContentInput,
  searchPagesInput,
  searchPagesOutput,
  storedPageOutput,
  storedTabOutput,
} from "@/features/mcp/tool-schemas";
import { applyEdits, type EditsResult } from "@/features/mcp/edits";
import { NAME_RULE, USER_TEXT_NOTE } from "@/features/mcp/tool-schemas";
import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";
import { TITLE_HEADING_MISSING_MESSAGE } from "@/features/pages/schema";
import * as pageService from "@/features/pages/service";
import {
  SEARCH_MAX_CHARACTERS,
  SEARCH_MAX_RESULTS,
  SEARCH_MAX_WORDS,
  SEARCH_TOOL_DEFAULT_RESULTS,
  SEARCH_TOOL_MAX_RESULTS,
} from "@/features/search/limits";
import * as searchService from "@/features/search/service";
import { deletedPagesPath, folderPath, pagePath, tabPath } from "@/lib/addresses";
import { logger } from "@/lib/logger";
import { NAME_MAX_LENGTH } from "@/lib/name-limits";

/** What the tools need to know about the wiki they serve and the connection they serve it to. */
export type WikiToolsOptions = {
  /**
   * The public address of the wiki (`HIPPOWIKI_PUBLIC_URL`), without a trailing slash, as the adapter checked it: the
   * tools give out full URLs that a person can open. Without it there is no MCP server.
   */
  publicUrl: string;
  /** The actor of MCP: the user of the token of the request and the connection of its grant. */
  actor: McpActor;
  /** The folder of the connection, as the adapter read it for this request; its name is the current one. */
  folder: { id: string; name: string };
};

/** The result of a tool that worked: the data for the client, and the same as text for the model. */
function result(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

/**
 * The data of a result that carries titles or content of pages, with the field `note` first: it comes first both in
 * the structured data and in the JSON of the text, so that the model reads it before the page text. Titles and
 * content stay as the service returned them.
 */
function withNote<Data extends Record<string, unknown>>(data: Data): { note: typeof USER_TEXT_NOTE } & Data {
  return { note: USER_TEXT_NOTE, ...data };
}

/**
 * The result of a tool that could not do what was asked, e.g. because a page does not exist. It is a tool error
 * and not a protocol error, so the model reads the message and can try again with other arguments. It carries no
 * note, because its message holds no title or content written by another user.
 */
function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** The answer to a failed read or write that cannot be told apart from the outside. */
const READ_FAILED = "The wiki could not be read. Please try again later.";
const WRITE_FAILED = "The change could not be stored. Please try again later.";

/** The keys of the arguments of a tool that name a tab or a page, as the log line of a call gives them. */
const NAME_KEYS = ["tab", "page", "name", "newTab", "newName"] as const;

/** The tab and page names of the arguments of a call, `null` for "directly in the folder". */
type LoggedNames = Partial<Record<(typeof NAME_KEYS)[number], string | null>>;

/**
 * The tab and page names of the arguments of a call, and nothing else of them: never content, replacements, a title, an
 * address or a version. A name is the agent's own input, which the input schema does not check, so one longer than the
 * length limit of a name is cut to it, and a line stays short.
 */
function namesOf(input: Record<string, unknown>): LoggedNames {
  const names: LoggedNames = {};
  for (const key of NAME_KEYS) {
    const value = input[key];
    if (value === null) names[key] = null;
    else if (typeof value === "string") names[key] = value.slice(0, NAME_MAX_LENGTH);
  }
  return names;
}

/**
 * Runs a tool and logs the call. An unexpected error, such as a database that cannot be reached, is logged and
 * answered with a general message: the SDK would otherwise pass the message of the error on to the client. Every call
 * that reaches a tool leaves one line `mcp tool called`, so that what an agent did can be traced to the grant, the user
 * and the folder of its connection (see "What holds for all of them" in `spec/mcp.md`). A call that the SDK refuses
 * before the tool runs never reaches this function.
 */
async function run(
  options: WikiToolsOptions,
  tool: string,
  input: Record<string, unknown>,
  work: () => Promise<CallToolResult>,
  failed: string = READ_FAILED,
): Promise<CallToolResult> {
  let answer: CallToolResult;
  let outcome: "worked" | "tool-error" | "failed";
  try {
    answer = await work();
    outcome = answer.isError ? "tool-error" : "worked";
  } catch (err) {
    logger.error({ err, tool }, "mcp tool failed");
    answer = toolError(failed);
    outcome = "failed";
  }
  const { actor, folder } = options;
  logger.info(
    {
      grantId: actor.connection.grantId,
      userId: actor.id,
      folderId: folder.id,
      role: actor.connection.role,
      tool,
      names: namesOf(input),
      outcome,
    },
    "mcp tool called",
  );
  return answer;
}

/** The address of a path of the wiki: the full URL that a person can open. */
function addressOf({ publicUrl }: WikiToolsOptions, path: string): string {
  return `${publicUrl}${path}`;
}

/** The answer when the folder of the connection cannot be read with the actor any more, e.g. after a role change. */
function folderGone(): CallToolResult {
  return toolError("The folder of this connection cannot be read any more. The user's role on it may have changed.");
}

/** Where a page is, as a message names it: directly in the folder, or in a tab of it. */
function placeOf(folderName: string, tab: string | null): string {
  return tab === null ? `directly in the folder "${folderName}"` : `in the tab "${tab}" of the folder "${folderName}"`;
}

/** The tool error of a page that does not exist, also a deleted one, with where to find the pages. */
function pageNotFound(folderName: string, tab: string | null, page: string): CallToolResult {
  return toolError(
    `There is no page named "${page}" ${placeOf(folderName, tab)}. Use list_folder to see the pages of the folder ` +
      "and the tab each one is in.",
  );
}

/** Compares two names. Names are lowercase letters, digits and hyphens, so comparing the strings sorts them. */
function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The order of `list_folder`: the pages placed directly in the folder first, then the pages in tabs, by tab and then
 * by name. It is sorted here and not taken from the service, whose order is the one of the list "All pages" of the
 * browser: by name and then by tab (`directPageFirstPerName()` in the pages service).
 */
function sortByTabThenName<Page extends { name: string; tab: { name: string } | null }>(pages: Page[]): Page[] {
  return pages.toSorted((a, b) => {
    if (a.tab === null || b.tab === null) {
      if (a.tab !== b.tab) return a.tab === null ? -1 : 1;
    } else {
      const byTab = compareNames(a.tab.name, b.tab.name);
      if (byTab !== 0) return byTab;
    }
    return compareNames(a.name, b.name);
  });
}

/** The tool `list_folder`: the tabs and pages of the folder of the connection, the pages placed directly in it first. */
export async function listFolder(options: WikiToolsOptions): Promise<CallToolResult> {
  return run(options, "list_folder", {}, async () => {
    const { actor, folder } = options;
    const tabs = await folderService.listTabs(actor, folder.id);
    // The service leaves deleted pages out.
    const allPages = await pageService.listAllFolderPages(actor, folder.id);
    // `null` when the actor may no longer read the folder.
    if (!tabs || !allPages) return folderGone();
    const pages = sortByTabThenName(allPages);
    return result(
      withNote({
        folder: { name: folder.name, address: addressOf(options, folderPath(folder.name)) },
        tabs: tabs.map((tab) => ({
          name: tab.name,
          address: addressOf(options, tabPath(folder.name, tab.name)),
          lastChanged: tab.updatedAt.toISOString(),
          lastEditedBy: tab.lastEditedBy.name,
          lastEditedVia: tab.lastEditedBy.via,
        })),
        pages: pages.map((page) => ({
          name: page.name,
          title: page.title,
          tab: page.tab?.name ?? null,
          address: addressOf(options, pagePath(folder.name, page.tab?.name ?? null, page.name)),
          lastChanged: page.updatedAt.toISOString(),
          lastEditedBy: page.lastEditedBy.name,
          lastEditedVia: page.lastEditedBy.via,
        })),
      }) satisfies z.infer<typeof listFolderOutput>,
    );
  });
}

/**
 * The tool `read_page`: a page of the folder of the connection by its tab, if it is in one, and its name, with its
 * version. A deleted page is not found.
 */
export async function readPage(
  options: WikiToolsOptions,
  input: z.infer<typeof readPageInput>,
): Promise<CallToolResult> {
  return run(options, "read_page", input, async () => {
    const tab = input.tab ?? null;
    const page = await pageService.getPage(options.actor, options.folder.name, tab, input.page);
    if (!page) return pageNotFound(options.folder.name, tab, input.page);
    return result(
      withNote({
        name: page.name,
        title: page.title,
        folder: page.folder.name,
        tab: page.tab?.name ?? null,
        content: page.content,
        address: addressOf(options, pagePath(page.folder.name, page.tab?.name ?? null, page.name)),
        lastChanged: page.updatedAt.toISOString(),
        lastEditedBy: page.lastEditedBy.name,
        lastEditedVia: page.lastEditedBy.via,
        version: page.version,
      }) satisfies z.infer<typeof readPageOutput>,
    );
  });
}

/** Whether the value is a whole number from `min` to `max`. */
function isWholeNumber(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * The tool error of a search that returned no results for a reason of its own. The texts of a search that is too
 * long, too broad or refused as busy are those of the browser; none holds a title or text of a page.
 */
function searchError(error: searchService.SearchError): CallToolResult {
  switch (error.code) {
    case "no-words":
      return toolError("The query has no words to search for. Give at least one word with a letter or a digit.");
    case "too-long":
      return toolError(
        `Search at most ${SEARCH_MAX_CHARACTERS} characters and ${SEARCH_MAX_WORDS} words. Each word counts once, ` +
          "also inside quotes and with a leading -; or between two words does not count.",
      );
    case "too-broad":
      return toolError("This search is too broad and took too long. Use more precise words.");
    case "busy":
      return toolError("Too many searches are running. Try again in a few seconds.");
  }
}

/**
 * The tool `search_pages`: the pages of the folder of the connection that match the words of the query, the best
 * first, with a piece of their text, `limit` at a time from `offset` on, up to the `SEARCH_MAX_RESULTS` best ones. It
 * takes no tab: a search always covers the whole folder. Deleted pages are never found. The query is never logged:
 * people search for names and incidents.
 */
export async function searchPages(
  options: WikiToolsOptions,
  input: z.infer<typeof searchPagesInput>,
): Promise<CallToolResult> {
  return run(options, "search_pages", input, async () => {
    const limit = input.limit ?? SEARCH_TOOL_DEFAULT_RESULTS;
    const offset = input.offset ?? 0;
    if (!isWholeNumber(limit, 1, SEARCH_TOOL_MAX_RESULTS)) {
      return toolError(
        `Ask for at most ${SEARCH_TOOL_MAX_RESULTS} results at a time: limit is a whole number from 1 to ` +
          `${SEARCH_TOOL_MAX_RESULTS}. Use offset for the next results.`,
      );
    }
    if (!isWholeNumber(offset, 0, SEARCH_MAX_RESULTS - 1)) {
      return toolError(
        `The offset is a whole number from 0 to ${SEARCH_MAX_RESULTS - 1}: only the ${SEARCH_MAX_RESULTS} best ` +
          "results can be reached. Use more precise words to find other pages.",
      );
    }
    const { actor, folder } = options;
    const found = await searchService.searchPages(actor, folder.id, input.query, { offset, limit });
    // `null` when the actor may no longer read the folder.
    if (!found) return folderGone();
    if (!found.ok) return searchError(found.error);
    const { results, total, more } = found.value;
    const next = offset + results.length;
    return result(
      withNote({
        results: results.map((page) => ({
          title: page.title,
          name: page.name,
          tab: page.tab?.name ?? null,
          address: addressOf(options, pagePath(folder.name, page.tab?.name ?? null, page.name)),
          excerpt: page.excerpt.map((part) => part.text).join(""),
          lastChanged: page.updatedAt.toISOString(),
          lastEditedBy: page.lastEditedBy.name,
          lastEditedVia: page.lastEditedBy.via,
        })),
        nextOffset: results.length > 0 && next < total ? next : null,
        more,
      }) satisfies z.infer<typeof searchPagesOutput>,
    );
  });
}

/** The answer when the role on the folder does not allow a change, e.g. because it was lowered meanwhile. */
const NOT_ALLOWED = "Your role on the folder does not allow this change, so nothing was changed.";

/**
 * The tool error of a tab that does not exist, also one deleted meanwhile: a connection that may create tabs learns
 * that it can create the tab, the other connections that tabs are created in the browser.
 */
function tabNotFound(options: WikiToolsOptions, tab: string): CallToolResult {
  const create = mayDo(options.actor.connection.role, "editTab")
    ? "or create the tab with create_tab"
    : "tabs are created in the browser";
  return toolError(
    `There is no tab named "${tab}" in the folder "${options.folder.name}", so nothing was changed. Use list_folder ` +
      `to see the tabs of the folder; ${create}.`,
  );
}

/**
 * The id of the tab with the given name in the folder of the connection, `null` for none, or the tool error for a tab
 * that does not exist.
 */
async function tabIdOf(
  options: WikiToolsOptions,
  tab: string | null | undefined,
): Promise<{ tabId: string | null; error?: never } | { error: CallToolResult }> {
  if (tab === null || tab === undefined) return { tabId: null };
  const found = await folderService.getTab(options.actor, options.folder.name, tab);
  return found ? { tabId: found.id } : { error: tabNotFound(options, tab) };
}

/**
 * A field message of the forms as a sentence: the forms show it without a full stop, so a message that does not end
 * with `.`, `!` or `?` gets one, and a tool error that quotes several messages reads as separate sentences.
 */
function asSentence(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

/** The tool error of input that the service refused, with what to do next. */
function invalidInput(fieldErrors: { name?: string[]; content?: string[] }): CallToolResult {
  const messages: string[] = [];
  if (fieldErrors.content?.length) {
    messages.push(
      fieldErrors.content.includes(TITLE_HEADING_MISSING_MESSAGE)
        ? "The content must start with a title heading, such as # Title. Add one and try again."
        : `The content is not valid: ${fieldErrors.content.map(asSentence).join(" ")}`,
    );
  }
  if (fieldErrors.name?.length) {
    messages.push(
      `The name is not valid: ${fieldErrors.name.map(asSentence).join(" ")} A name has lowercase letters, digits and single ` +
        "hyphens, such as release-notes.",
    );
  }
  return toolError(`${messages.join(" ")} Nothing was changed.`);
}

function nameTaken(folderName: string, tab: string | null, name: string): CallToolResult {
  return toolError(
    `A page named "${name}" already exists ${placeOf(folderName, tab)}, so nothing was changed. Choose another ` +
      "name, or use replace_page_content to change that page.",
  );
}

/**
 * The tool error of a change based on an older version than the stored one, or on no valid version: who changed the
 * page last, how and when, and that the page has to be read again.
 */
async function pageChanged(options: WikiToolsOptions, stored: pageService.StoredPage): Promise<CallToolResult> {
  const page = await pageService.getPage(options.actor, options.folder.name, stored.tab?.name ?? null, stored.name);
  const by = page
    ? ` by ${page.lastEditedBy.name} via ${page.lastEditedBy.via} at ${page.updatedAt.toISOString()}`
    : "";
  return toolError(
    `The page was changed${by}, after the version this change is based on, or the change states no valid version. ` +
      "Nothing was changed. Read the page again with read_page and base the change on its current content and " +
      "version.",
  );
}

/**
 * The page as stored by a write, as `create_page`, `replace_page_content`, `edit_page_content` and
 * `move_or_rename_page` return it, with the note first, its title and its version: the new one after a change, the same one after a
 * content save, or a move to the own name and place, without a change, which stores nothing.
 */
function storedPageData(options: WikiToolsOptions, stored: pageService.StoredPage): z.infer<typeof storedPageOutput> {
  const tab = stored.tab?.name ?? null;
  return withNote({
    name: stored.name,
    title: stored.title,
    tab,
    address: addressOf(options, pagePath(options.folder.name, tab, stored.name)),
    version: stored.version,
  });
}

function storedResult(options: WikiToolsOptions, stored: pageService.StoredPage): CallToolResult {
  return result(storedPageData(options, stored));
}

/**
 * The tool `create_page`: a new page with the given content in the folder of the connection or one of its tabs. Without
 * a name it gets the name the browser suggests for its title.
 */
export async function createPage(
  options: WikiToolsOptions,
  input: z.infer<typeof createPageInput>,
): Promise<CallToolResult> {
  return run(
    options,
    "create_page",
    input,
    async () => {
      const { folder } = options;
      const place = await tabIdOf(options, input.tab);
      if (place.error) return place.error;
      // Without a name, the service derives it from the title, after its own checks.
      const created = await pageService.createPage(options.actor, folder.id, {
        ...(input.name === undefined ? {} : { name: input.name }),
        content: input.content,
        tabId: place.tabId,
      });
      if (created.ok) return storedResult(options, created.value);
      switch (created.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "folder-not-found":
          return folderGone();
        case "tab-not-found":
          return tabNotFound(options, input.tab ?? "");
        case "invalid-input":
          return invalidInput(created.error.fieldErrors);
        case "no-suggested-name":
          return toolError(
            `The title suggests no name for the page, so nothing was changed. Give a name of ${NAME_RULE}.`,
          );
        case "name-taken":
          return nameTaken(folder.name, input.tab ?? null, created.error.name);
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}

/** The tool `replace_page_content`: the whole content of a page of the folder of the connection, based on a version. */
export async function replacePageContent(
  options: WikiToolsOptions,
  input: z.infer<typeof replacePageContentInput>,
): Promise<CallToolResult> {
  return run(
    options,
    "replace_page_content",
    input,
    async () => {
      const tab = input.tab ?? null;
      const page = await pageService.getPage(options.actor, options.folder.name, tab, input.page);
      if (!page) return pageNotFound(options.folder.name, tab, input.page);
      const saved = await pageService.updatePageContent(options.actor, page.id, {
        content: input.content,
        version: input.version ?? null,
      });
      if (saved.ok) return storedResult(options, saved.value);
      return contentNotSaved(options, tab, input.page, saved.error);
    },
    WRITE_FAILED,
  );
}

/** The tool error of a content save that the service refused, as `replace_page_content` and `edit_page_content` give it. */
function contentNotSaved(
  options: WikiToolsOptions,
  tab: string | null,
  page: string,
  error: pageService.UpdatePageContentError,
): CallToolResult | Promise<CallToolResult> {
  switch (error.code) {
    case "not-allowed":
      return toolError(NOT_ALLOWED);
    case "page-not-found":
      return pageNotFound(options.folder.name, tab, page);
    case "page-changed":
      return pageChanged(options, error.page);
    case "invalid-input":
      return invalidInput(error.fieldErrors);
    case "failed":
      return toolError(WRITE_FAILED);
  }
}

/** The most characters of a text to find that an error quotes, so that the error of a long text stays short. */
const QUOTED_TEXT_LENGTH = 60;

/** The start of a text to find, as an error quotes it: as JSON, so that line breaks and quotes stay visible. */
function quoted(text: string): string {
  return JSON.stringify(text.length > QUOTED_TEXT_LENGTH ? `${text.slice(0, QUOTED_TEXT_LENGTH)}…` : text);
}

/**
 * The tool error of a replacement that cannot be applied: which one, by its position and the start of its text to
 * find, that nothing was changed, and what to do next.
 */
function editNotApplied(failure: Extract<EditsResult, { ok: false }>): CallToolResult {
  const { position, oldText, reason } = failure;
  const replacement = `Replacement ${position} (oldText ${quoted(oldText)})`;
  switch (reason.code) {
    case "no-edits":
      return toolError("The call has no replacements, so nothing was changed. Send at least one replacement in edits.");
    case "empty-old-text":
      return toolError(
        `Replacement ${position} has an empty oldText, so nothing was changed. Send the exact text to find, as ` +
          "read_page gave the content.",
      );
    case "no-change":
      return toolError(
        `${replacement} has a newText that is the same as its oldText, so nothing was changed. Send a newText that ` +
          "differs from it, or leave the replacement out.",
      );
    case "not-found":
      // A plain error, without a guess at similar text, so that the agent reads the real text again.
      return toolError(
        `${replacement} was not found in the content, as the replacements before it left it, so nothing was ` +
          "changed. The text must match exactly, case, spaces, indentation and line breaks included. Read the page " +
          "again with read_page and copy the text from its content.",
      );
    case "found-several-times":
      return toolError(
        `${replacement} was found ${reason.count} times in the content, so nothing was changed. Add surrounding ` +
          "text to oldText so that it appears exactly once, or set replaceAll to replace every place.",
      );
    case "too-long":
      return toolError(
        `${replacement} would make the content longer than ${CONTENT_MAX_LENGTH.toLocaleString("en-US")} ` +
          "characters, the length limit of a page, so nothing was changed.",
      );
  }
}

/**
 * The tool `edit_page_content`: exact texts of the content of a page of the folder of the connection replaced by new
 * texts, based on a version, and stored as one change, or nothing at all. The version is checked before the
 * replacements, so that a call based on an older version learns who changed the page, also when one of its texts is
 * gone. The service checks the new content like content saved in full and stores nothing when it is
 * the same as before (see "Changing parts of a page" in `spec/mcp.md`).
 */
export async function editPageContent(
  options: WikiToolsOptions,
  input: z.infer<typeof editPageContentInput>,
): Promise<CallToolResult> {
  return run(
    options,
    "edit_page_content",
    input,
    async () => {
      const tab = input.tab ?? null;
      const page = await pageService.getPage(options.actor, options.folder.name, tab, input.page);
      if (!page) return pageNotFound(options.folder.name, tab, input.page);
      if (input.version !== page.version) return pageChanged(options, page);
      const edited = applyEdits(page.content, input.edits);
      if (!edited.ok) return editNotApplied(edited);
      // The version of the call, so that a change between the read above and the write is refused as well.
      const saved = await pageService.updatePageContent(options.actor, page.id, {
        content: edited.content,
        version: input.version,
      });
      if (!saved.ok) return contentNotSaved(options, tab, input.page, saved.error);
      return result({
        ...storedPageData(options, saved.value),
        replaced: edited.counts,
      } satisfies z.infer<typeof editedPageOutput>);
    },
    WRITE_FAILED,
  );
}

/**
 * The tool `move_or_rename_page`: a page of the folder of the connection to another tab of it, or directly into it,
 * and with a new name, based on a version.
 */
export async function moveOrRenamePage(
  options: WikiToolsOptions,
  input: z.infer<typeof moveOrRenamePageInput>,
): Promise<CallToolResult> {
  return run(
    options,
    "move_or_rename_page",
    input,
    async () => {
      const tab = input.tab ?? null;
      const page = await pageService.getPage(options.actor, options.folder.name, tab, input.page);
      if (!page) return pageNotFound(options.folder.name, tab, input.page);
      const place = await tabIdOf(options, input.newTab);
      if (place.error) return place.error;
      const moved = await pageService.moveOrRenamePage(options.actor, page.id, {
        name: input.newName,
        tabId: place.tabId,
        version: input.version ?? null,
      });
      if (moved.ok) return storedResult(options, moved.value);
      switch (moved.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "page-not-found":
          return pageNotFound(options.folder.name, tab, input.page);
        case "page-changed":
          return pageChanged(options, moved.error.page);
        case "tab-not-found":
          return tabNotFound(options, input.newTab ?? "");
        case "invalid-input":
          return invalidInput(moved.error.fieldErrors);
        case "name-taken":
          return nameTaken(options.folder.name, input.newTab, input.newName);
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}

/** What a delete tells the agent about restoring: only a person in the browser restores deleted pages. */
const RESTORE_PAGE =
  "The page can be restored by a Manager or Owner of the folder in the browser, under Deleted pages at the address " +
  "deletedPagesAddress. Deleted pages can be neither seen nor restored through this connection.";

/**
 * The tool `delete_page`: a page of the folder of the connection by its tab, if it is in one, and its name, based on a
 * version, deleted as in the browser: it goes to the deleted pages of the folder, from where a person can restore it.
 */
export async function deletePage(
  options: WikiToolsOptions,
  input: z.infer<typeof deletePageInput>,
): Promise<CallToolResult> {
  return run(
    options,
    "delete_page",
    input,
    async () => {
      const tab = input.tab ?? null;
      const page = await pageService.getPage(options.actor, options.folder.name, tab, input.page);
      if (!page) return pageNotFound(options.folder.name, tab, input.page);
      const deleted = await pageService.deletePage(options.actor, page.id, { version: input.version ?? null });
      if (deleted.ok) {
        return result(
          withNote({
            name: page.name,
            title: page.title,
            tab: deleted.value.tab?.name ?? null,
            deletedPagesAddress: addressOf(options, deletedPagesPath(deleted.value.folder.name)),
            restore: RESTORE_PAGE,
          }) satisfies z.infer<typeof deletedPageOutput>,
        );
      }
      switch (deleted.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "page-not-found":
          return pageNotFound(options.folder.name, tab, input.page);
        case "page-changed":
          return pageChanged(options, deleted.error.page);
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}

/** The tool error of a tab name that another tab of the folder has. */
function tabNameTaken(options: WikiToolsOptions, name: string, next: string): CallToolResult {
  return toolError(
    `A tab named "${name}" already exists in the folder "${options.folder.name}", so nothing was changed. ${next}`,
  );
}

/** The tab as stored by a write, as `create_tab` and `rename_tab` return it, with its address. */
function storedTabResult(options: WikiToolsOptions, tab: folderService.StoredTab): CallToolResult {
  return result({
    name: tab.name,
    address: addressOf(options, tabPath(tab.folder.name, tab.name)),
  } satisfies z.infer<typeof storedTabOutput>);
}

/** The tool `create_tab`: a new, empty tab of the folder of the connection with the given name. */
export async function createTab(
  options: WikiToolsOptions,
  input: z.infer<typeof createTabInput>,
): Promise<CallToolResult> {
  return run(
    options,
    "create_tab",
    input,
    async () => {
      const created = await folderService.createTab(options.actor, options.folder.id, { name: input.name });
      if (created.ok) return storedTabResult(options, created.value);
      switch (created.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "folder-not-found":
          return folderGone();
        case "invalid-input":
          return invalidInput(created.error.fieldErrors);
        case "name-taken":
          return tabNameTaken(options, input.name, "Choose another name, or put the pages into that tab.");
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}

/**
 * The tool `rename_tab`: a tab of the folder of the connection, by its current name, with a new name. As in the
 * browser, a rename is not checked against changes meanwhile; the addresses of the pages in the tab change with it.
 */
export async function renameTab(
  options: WikiToolsOptions,
  input: z.infer<typeof renameTabInput>,
): Promise<CallToolResult> {
  return run(
    options,
    "rename_tab",
    input,
    async () => {
      const tab = await folderService.getTab(options.actor, options.folder.name, input.tab);
      if (!tab) return tabNotFound(options, input.tab);
      const renamed = await folderService.renameTab(options.actor, tab.id, { name: input.newName });
      if (renamed.ok) return storedTabResult(options, renamed.value);
      switch (renamed.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "tab-not-found":
          return tabNotFound(options, input.tab);
        case "invalid-input":
          return invalidInput(renamed.error.fieldErrors);
        case "name-taken":
          return tabNameTaken(options, input.newName, "Choose another name.");
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}

/** What `delete_tab` tells the agent about restoring: the tab is gone, its pages come back one by one in the browser. */
const RESTORE_TAB_PAGES =
  "The tab is deleted for good and cannot be restored. Its pages can be restored one by one by a Manager or Owner of " +
  "the folder in the browser, under Deleted pages at the address deletedPagesAddress. Deleted pages can be neither " +
  "seen nor restored through this connection.";

/**
 * The tool `delete_tab`: a tab of the folder of the connection, by its name, deleted for good together with all its
 * pages, as deleting it in the browser does, without a further confirmation: the description warns of it before the
 * call. The pages go to the deleted pages of the folder.
 */
export async function deleteTab(
  options: WikiToolsOptions,
  input: z.infer<typeof deleteTabInput>,
): Promise<CallToolResult> {
  return run(
    options,
    "delete_tab",
    input,
    async () => {
      const tab = await folderService.getTab(options.actor, options.folder.name, input.tab);
      if (!tab) return tabNotFound(options, input.tab);
      const deleted = await folderService.deleteTab(options.actor, options.folder.id, tab.id);
      if (deleted.ok) {
        return result(
          withNote({
            name: tab.name,
            pageCount: deleted.value.pageCount,
            pages: deleted.value.pages.map(({ name, title }) => ({ name, title })),
            deletedPagesAddress: addressOf(options, deletedPagesPath(deleted.value.folder.name)),
            restore: RESTORE_TAB_PAGES,
          }) satisfies z.infer<typeof deletedTabOutput>,
        );
      }
      switch (deleted.error.code) {
        case "not-allowed":
          return toolError(NOT_ALLOWED);
        case "tab-not-found":
          return tabNotFound(options, input.tab);
        case "failed":
          return toolError(WRITE_FAILED);
      }
    },
    WRITE_FAILED,
  );
}
