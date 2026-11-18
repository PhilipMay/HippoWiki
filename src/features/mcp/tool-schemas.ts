// The inputs and outputs of the MCP tools, as the SDK checks them and a client reads them. A description is all the
// model learns about an argument or a field, so each one is written once here. The name of a tab or page that exists
// is a plain string: a name that no item has, malformed ones included, is answered by the tool with its not-found
// error, which tells the model where to find the names (see "What holds for all of them" in `spec/mcp.md`).

import { z } from "zod";

import { NAME_MAX_LENGTH } from "@/lib/name-limits";

/**
 * The whole rule of a tab or page name, length limit included, as the instructions, the descriptions of the arguments
 * that take a new name and the error for a title without a name state it, so that a model learns it before a call.
 */
export const NAME_RULE = `lowercase letters, digits and single hyphens, at most ${NAME_MAX_LENGTH} characters`;

/**
 * The tab a page is in, as a tool takes it. `null` is accepted next to a missing tab, because `list_folder` returns
 * the tab of such a page as `null`. The description comes last: one on the name alone would be lost when the argument
 * may also be `null`.
 */
const TAB_ARGUMENT = z
  .string()
  .nullable()
  .optional()
  .describe(
    "The name of the tab the page is in. Leave it out, or pass null, for a page placed directly in the folder.",
  );

/** The name of a page that exists, as list_folder returns it. */
const PAGE_ARGUMENT = z.string().describe("The name of the page, without the .md at the end of its address");

/** The version that a change or a delete of a page is based on. */
const VERSION_ARGUMENT = z
  .number()
  .int()
  .optional()
  .describe("The version of the page that read_page gave; the change is refused if the page has changed since");

/** A tab that exists, by its name; a name that no tab has is a tool error that says how to find the tabs. */
const EXISTING_TAB_ARGUMENT = z.string().describe("The name of the tab, as list_folder returns it");

/** A new tab name as a tool takes it: checked by the service, so that a bad name is a tool error with the rule. */
function newTabNameArgument(description: string) {
  return z.string().describe(`${description}: ${NAME_RULE}, such as meeting-notes`);
}

/** The page a write tool changes: its tab, if it is in one, its name, and the version the write is based on. */
const pageArguments = { tab: TAB_ARGUMENT, page: PAGE_ARGUMENT, version: VERSION_ARGUMENT };

export const readPageInput = z.object({ tab: TAB_ARGUMENT, page: PAGE_ARGUMENT });

export const createPageInput = z.object({
  content: z
    .string()
    .describe("The whole Markdown content of the new page. It must start with a title heading: # Title"),
  tab: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The name of an existing tab to create the page in. Leave it out, or pass null, to place it directly in the folder.",
    ),
  name: z
    .string()
    .optional()
    .describe(`The name of the page in its address: ${NAME_RULE}. Leave it out to derive it from the title.`),
});

export const replacePageContentInput = z.object({
  ...pageArguments,
  content: z
    .string()
    .describe("The whole new Markdown content of the page. It must start with a title heading: # Title"),
});

/**
 * The replacements of `edit_page_content`. The list has no minimum and no maximum, and no text is refused here: every
 * mistake is a tool error of the tool that says what to do (see "What holds for all of them" in `spec/mcp.md`).
 */
export const editPageContentInput = z.object({
  ...pageArguments,
  edits: z
    .array(
      z.object({
        oldText: z
          .string()
          .describe(
            "The exact text to find, as read_page gave the content: case, spaces, indentation and line breaks count. " +
              "It must appear exactly once in the content, unless replaceAll is set.",
          ),
        newText: z.string().describe("The text that replaces oldText, inserted exactly as it is"),
        replaceAll: z
          .boolean()
          .optional()
          .describe("Replace every place where oldText appears, instead of exactly one place"),
      }),
    )
    .describe(
      "The replacements, applied in the order given, each to the content as the replacements before it left it",
    ),
});

export const moveOrRenamePageInput = z.object({
  ...pageArguments,
  newTab: z
    .string()
    .nullable()
    .describe(
      "The name of an existing tab of the folder to move the page to, or null to place it directly in the folder",
    ),
  newName: z.string().describe(`The new name of the page: ${NAME_RULE}. Pass the old name to keep it.`),
});

export const deletePageInput = z.object(pageArguments);

export const createTabInput = z.object({ name: newTabNameArgument("The name of the new tab") });

export const renameTabInput = z.object({
  tab: EXISTING_TAB_ARGUMENT,
  newName: newTabNameArgument("The new name of the tab"),
});

export const deleteTabInput = z.object({ tab: EXISTING_TAB_ARGUMENT });

/** The user name of the last editor, as every tool that names it describes it. */
const lastEditedByOutput = (item: string) => z.string().describe(`The user name of who changed the ${item} last`);

/** How an item was last changed, as every tool that names it describes it. */
const lastEditedViaOutput = (item: string) =>
  z
    .enum(["web", "mcp"])
    .describe(
      `How the ${item} was last changed: web for a change by a person in the browser, mcp for a change by an AI app ` +
        "through MCP",
    );

/** When an item was last changed, as every tool that names it describes it. */
const lastChangedOutput = (item: string) =>
  z.string().describe(`When the ${item} was last changed, as an ISO 8601 time`);

/** Where a person opens an item in a browser. */
const addressOutput = (item: string) => z.string().describe(`Where a person opens the ${item} in a browser`);

/** The tab a page is in, or was in before it was deleted. */
const pageTabOutput = (verb: "is" | "was") =>
  z.string().nullable().describe(`The tab the page ${verb} in, or null for a page placed directly in the folder`);

/** Where the deleted pages of the folder are, as both delete tools give it. */
const DELETED_PAGES_ADDRESS_OUTPUT = z
  .string()
  .describe("Where a person sees the deleted pages of the folder in a browser, as a Manager or Owner restores them");

export const listFolderOutput = z.object({
  folder: z.object({ name: z.string(), address: z.string() }),
  tabs: z.array(
    z.object({
      name: z.string(),
      address: z.string(),
      lastChanged: lastChangedOutput("tab itself"),
      lastEditedBy: lastEditedByOutput("tab itself"),
      lastEditedVia: lastEditedViaOutput("tab itself"),
    }),
  ),
  pages: z
    .array(
      z.object({
        name: z.string(),
        title: z.string(),
        tab: pageTabOutput("is"),
        address: z.string(),
        lastChanged: lastChangedOutput("page"),
        lastEditedBy: lastEditedByOutput("page"),
        lastEditedVia: lastEditedViaOutput("page"),
      }),
    )
    .describe("The pages placed directly in the folder first, then the pages in tabs"),
});

export const readPageOutput = z.object({
  name: z.string(),
  title: z.string(),
  folder: z.string(),
  tab: z.string().nullable(),
  content: z.string().describe("The Markdown source of the page"),
  address: addressOutput("page"),
  lastChanged: lastChangedOutput("page"),
  lastEditedBy: lastEditedByOutput("page"),
  lastEditedVia: lastEditedViaOutput("page"),
  version: z.number().int().describe("The version of the page, counted up by every change"),
});

export const storedPageOutput = z.object({
  name: z.string(),
  title: z.string(),
  tab: z.string().nullable(),
  address: addressOutput("page"),
  version: z
    .number()
    .int()
    .describe(
      "The version of the page as stored, for the next change: counted up by a change, kept when the content, or " +
        "the name and place, are the same as before",
    ),
});

/** The page as stored by `edit_page_content`, with the places each replacement changed, and without the content. */
export const editedPageOutput = storedPageOutput.extend({
  replaced: z
    .array(z.number().int())
    .describe("How many places each replacement changed, in the order of the replacements"),
});

export const deletedPageOutput = z.object({
  name: z.string(),
  title: z.string(),
  tab: pageTabOutput("was"),
  deletedPagesAddress: DELETED_PAGES_ADDRESS_OUTPUT,
  restore: z.string().describe("How the page can be restored"),
});

export const storedTabOutput = z.object({
  name: z.string(),
  address: addressOutput("tab"),
});

export const deletedTabOutput = z.object({
  name: z.string().describe("The name the deleted tab had"),
  pageCount: z.number().int().describe("How many pages were deleted with the tab"),
  pages: z
    .array(z.object({ name: z.string(), title: z.string() }))
    .describe("Every page deleted with the tab, by name, without a limit"),
  deletedPagesAddress: DELETED_PAGES_ADDRESS_OUTPUT,
  restore: z.string().describe("How the pages can be restored"),
});
