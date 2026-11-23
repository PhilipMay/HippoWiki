// The MCP server of a connection: which tools it gets, and how a client sees them (titles, descriptions, inputs,
// outputs and hints). A tool is registered only when the role of the connection may do the function of the folder
// that its write checks (`mayDo()` with `FUNCTION_ROLES`), so the list of tools follows the services when a function
// moves to another role. The handlers are `tools.ts`, the inputs and outputs `tool-schemas.ts`. No import of `next`
// or `react`, so the server loads wherever the services load.

import { McpServer } from "@modelcontextprotocol/server";

import { mayDo, ROLE_LABELS, type McpRole } from "@/features/folder-roles/roles";
import {
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
  NAME_RULE,
  readFileInput,
  readFileOutput,
  readPageInput,
  readPageOutput,
  renameTabInput,
  replacePageContentInput,
  searchPagesInput,
  searchPagesOutput,
  movedPageOutput,
  renamedTabOutput,
  storedPageOutput,
  storedTabOutput,
  USER_TEXT_NOTE,
} from "@/features/mcp/tool-schemas";
import {
  createPage,
  createTab,
  deletePage,
  deleteTab,
  editPageContent,
  listFolder,
  moveOrRenamePage,
  readFile,
  readPage,
  renameTab,
  replacePageContent,
  searchPages,
  type WikiToolsOptions,
} from "@/features/mcp/tools";
import { FILE_EXTENSIONS } from "@/lib/name-limits";
import { siteName } from "@/lib/site";

import packageJson from "../../../package.json";

/** How the server introduces itself to a client, with the version of the wiki. */
const SERVER_INFO = { name: "hippowiki", title: siteName, version: packageJson.version };

/** Which of the two tools that change the content of a page is for what, as the instructions tell the model. */
const CONTENT_TOOLS =
  "Use edit_page_content to change parts of a page, such as a sentence or a list item, and replace_page_content " +
  "only to rewrite a page as a whole.";

/**
 * What a connection of each role may do, as the instructions tell the model. Written by hand for the model; the tools
 * themselves follow `mayDo()`.
 */
const ROLE_ABILITIES: Readonly<Record<McpRole, string>> = {
  reader: "It reads the folder and cannot change it.",
  writer:
    "It reads the folder and changes its pages with create_page, edit_page_content, replace_page_content and " +
    `move_or_rename_page; it creates no tabs. ${CONTENT_TOOLS} Every change of a page states the version that ` +
    "read_page gave for it, and a change based on an older version is refused.",
  manager:
    "It reads the folder and changes its pages like a Writer connection, with create_page, edit_page_content, " +
    "replace_page_content and move_or_rename_page, deletes pages with delete_page, and creates, renames and deletes " +
    `tabs with create_tab, rename_tab and delete_tab. ${CONTENT_TOOLS} Every change and every delete of a page ` +
    "states the version that read_page gave for it, and one based on an older version is refused. Deleting a tab deletes all its pages and files with it. Deleted items " +
    "can be neither seen nor restored through this connection: only a Manager or Owner of the folder restores them, " +
    "in the browser.",
};

/** The grammar of wiki links, as the instructions tell the model. */
const WIKI_LINKS =
  "Pages link to other pages of the folder with wiki links: [[name]] for a page placed directly in the folder, " +
  "[[tab/name]] for a page in a tab, and [[name|label]] or [[tab/name|label]] to show a label instead of the title of " +
  "the page. The target comes first and is the name of the page, as read_page takes it, never its title, and has no " +
  ".md. A link to a page that does not exist is allowed and shown as missing.";

/** The files of a folder and their grammar in pages, as the instructions tell the model. */
const FILES =
  "The folder also holds files, images (PNG, JPEG, GIF, WebP) and PDFs, directly or in tabs, each named like a page " +
  `followed by the extension of its type: ${FILE_EXTENSIONS.join(", ")}, such as diagram.png. A page links a file ` +
  "with [[name.ext]] or [[tab/name.ext]] and shows an image with ![[name.ext]] or ![[tab/name.ext]], each with an " +
  "optional |label. list_folder and read_file give the details of files and search_pages finds them by their names, " +
  "but no tool returns the content of a file. A single file is uploaded, changed, moved, renamed or deleted only in " +
  "the browser.";

/**
 * What `initialize` tells the model about the wiki and the connection, in one paragraph: the folder and the role of
 * the connection, what the role allows, that page text and file names are data written by users of the wiki, how the
 * folder is organised, how pages link to each other and to files, and which tool to start with.
 */
export function instructionsFor(folderName: string, role: McpRole): string {
  return (
    `${siteName} is a wiki. This connection works on the folder "${folderName}" with the role ${ROLE_LABELS[role]}. ` +
    `${ROLE_ABILITIES[role]} ${USER_TEXT_NOTE} The folder holds pages, either directly or grouped in tabs, which are optional ` +
    "sections of the folder. Every page is written in Markdown and has a name, which is part of its address, and a " +
    `title, which is its first heading. Tab and page names are ${NAME_RULE}. ${WIKI_LINKS} ${FILES} Start ` +
    "with list_folder for the tabs, pages and files of the folder, or search_pages for the pages and files that " +
    "match some words, then read_page for the content of one page or read_file for the details of one file."
  );
}

/** What a read tool tells a client about itself: it only reads, and only the wiki. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** What a tool tells a client that writes to the wiki and destroys nothing. */
const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

/**
 * What a tool tells a client that changes the content of a page, which loses the content before: the whole of it with
 * `replace_page_content`, any text that a replacement of `edit_page_content` names.
 */
const OVERWRITES = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

/** What a tool tells a client that deletes from the wiki. */
const WRITES_AND_DELETES = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

/**
 * A new MCP server with the tools of the wiki for the connection of the request. The SDK asks for one per request, so
 * it holds nothing between requests.
 */
export function createWikiServer(options: WikiToolsOptions): McpServer {
  const { role } = options.actor.connection;
  const server = new McpServer(SERVER_INFO, { instructions: instructionsFor(options.folder.name, role) });

  if (mayDo(role, "read")) {
    server.registerTool(
      "list_folder",
      {
        title: "List the tabs, pages and files of the folder",
        description:
          "Lists the tabs, the pages and the files (images and PDFs) of the folder of this connection. Every page " +
          "comes with its name, its title, the tab it is in (null for a page placed directly in the folder), its " +
          "address and its wiki link, with which a page links it; pass the name and tab to read_page to read it. Every file comes with its name with its extension, its tab, its type, " +
          "size, the width and height of an image and the addresses of the file and of its details page, never its " +
          "content; pass its name and tab to read_file for the pages that show or link it. Every tab, page and file " +
          `also comes with when it was last changed, by whom and how: web in the browser, mcp by an AI app. ${USER_TEXT_NOTE}`,
        outputSchema: listFolderOutput,
        annotations: READ_ONLY,
      },
      () => listFolder(options),
    );

    server.registerTool(
      "read_page",
      {
        title: "Read a page",
        description:
          "Reads one page of the folder of this connection: its title, its Markdown content, its address, its wiki " +
          "link, with which a page links it, when it was last changed, by whom and how (web in the browser, mcp by an AI app), and its version. A page is " +
          `named by its tab if it is in one, and its own name, as list_folder returns them. ${USER_TEXT_NOTE}`,
        inputSchema: readPageInput,
        outputSchema: readPageOutput,
        annotations: READ_ONLY,
      },
      (input) => readPage(options, input),
    );

    server.registerTool(
      "search_pages",
      {
        title: "Search the pages of the folder",
        description:
          "Searches the pages of the whole folder of this connection by their titles, names and content, in the " +
          "language each page is written in. Every word must match, also by an inflection, its start, a part of a word " +
          'or a typo; "two words" in quotes match as a phrase, -word leaves out the pages with the word, and or ' +
          "between two words finds either. The best matches come first, each with its title, its name and tab, its " +
          "address and wiki link, a piece of its text and when it was last changed, by whom and how. Read the best results with read_page, " +
          "by their name and tab; ask for the next ones with nextOffset. The first call, with offset 0, also lists " +
          "in files the images and PDFs of the folder whose names match, each with its details and addresses but " +
          "never its content. Deleted pages and files are never found. " +
          USER_TEXT_NOTE,
        inputSchema: searchPagesInput,
        outputSchema: searchPagesOutput,
        annotations: READ_ONLY,
      },
      (input) => searchPages(options, input),
    );

    server.registerTool(
      "read_file",
      {
        title: "Read the details of a file",
        description:
          "Reads the details of one file (an image or a PDF) of the folder of this connection, never its content: " +
          "its name, its tab, its type, the size, width and height of its current version, the address of the file " +
          "and of its details page, when it was last changed, by whom and how, the number of its versions, and the " +
          "pages that show it with ![[…]] or link it with [[…]]. A file is named by its tab if it is in one, and its " +
          `own name with its extension, as list_folder returns them. Deleted files are never found. ${USER_TEXT_NOTE}`,
        inputSchema: readFileInput,
        outputSchema: readFileOutput,
        annotations: READ_ONLY,
      },
      (input) => readFile(options, input),
    );
  }

  if (mayDo(role, "editPage")) {
    server.registerTool(
      "create_page",
      {
        title: "Create a page",
        description:
          "Creates a new page in the folder of this connection, directly in the folder or in one of its existing " +
          "tabs, with the given Markdown content, which must start with a title heading. Without a name the page " +
          "gets the name derived from its title. It creates no tabs. Returns the page with its address and version. " +
          USER_TEXT_NOTE,
        inputSchema: createPageInput,
        outputSchema: storedPageOutput,
        annotations: WRITES,
      },
      (input) => createPage(options, input),
    );

    server.registerTool(
      "replace_page_content",
      {
        title: "Replace the content of a page",
        description:
          "Replaces the whole content of a page of the folder of this connection with the given Markdown, which " +
          "must start with a title heading; the title of the page follows it. It is for rewriting a page; to " +
          "change parts of it, use edit_page_content, which sends only the changed texts. State the version that read_page " +
          "gave: if the page has changed since, nothing is changed. Content that is the same as the stored content " +
          "changes nothing either. Returns the page with its version, which a change counts up and content without " +
          `a change keeps. ${USER_TEXT_NOTE}`,
        inputSchema: replacePageContentInput,
        outputSchema: storedPageOutput,
        annotations: OVERWRITES,
      },
      (input) => replacePageContent(options, input),
    );

    server.registerTool(
      "edit_page_content",
      {
        title: "Replace exact texts in the content of a page",
        description:
          "Changes parts of the content of a page of the folder of this connection, such as a sentence or a list " +
          "item: each replacement names an exact text of the content, as read_page gave it, and the text that " +
          "replaces it; to rewrite a page as a whole, use replace_page_content. A text must appear exactly " +
          "once, unless the replacement sets replaceAll. The replacements are applied in the order given, each to " +
          "the content as the ones before it left it, and stored as one change; if one of them cannot be applied, " +
          "nothing is changed. State the version that read_page gave: if the page has changed since, nothing is " +
          "changed. The content must still start with a title heading; the title of the page follows it. Returns " +
          `the page with its version and how many places each replacement changed. ${USER_TEXT_NOTE}`,
        inputSchema: editPageContentInput,
        outputSchema: editedPageOutput,
        annotations: OVERWRITES,
      },
      (input) => editPageContent(options, input),
    );
  }

  if (mayDo(role, "moveOrRenamePage")) {
    server.registerTool(
      "move_or_rename_page",
      {
        title: "Move or rename a page",
        description:
          "Moves a page of the folder of this connection to another existing tab of the folder, or directly into " +
          "the folder, and gives it a new name, which changes its address. State the version that read_page gave: " +
          "if the page has changed since, nothing is changed. A move to the current name and place changes " +
          "nothing. The wiki links to the page in every page of the folder, the page itself included, are changed to " +
          "its new name and place in the same change. Returns the page with its new address and version, and the " +
          `pages whose links were updated. ${USER_TEXT_NOTE}`,
        inputSchema: moveOrRenamePageInput,
        outputSchema: movedPageOutput,
        annotations: WRITES,
      },
      (input) => moveOrRenamePage(options, input),
    );
  }

  if (mayDo(role, "deletePage")) {
    server.registerTool(
      "delete_page",
      {
        title: "Delete a page",
        description:
          "Deletes a page of the folder of this connection, as deleting it in the browser does: it goes to the " +
          "deleted items of the folder, where a Manager or Owner can restore it in the browser; deleted items " +
          "cannot be seen or restored through this connection. State the version that read_page gave: if the page " +
          "has changed since, nothing is deleted. Returns the deleted page and the address of the deleted items of " +
          `the folder. ${USER_TEXT_NOTE}`,
        inputSchema: deletePageInput,
        outputSchema: deletedPageOutput,
        annotations: WRITES_AND_DELETES,
      },
      (input) => deletePage(options, input),
    );
  }

  if (mayDo(role, "editTab")) {
    server.registerTool(
      "create_tab",
      {
        title: "Create a tab",
        description:
          "Creates a new, empty tab in the folder of this connection. create_page and move_or_rename_page can put " +
          "pages into it at once. Returns the tab with its address.",
        inputSchema: createTabInput,
        outputSchema: storedTabOutput,
        annotations: WRITES,
      },
      (input) => createTab(options, input),
    );

    server.registerTool(
      "rename_tab",
      {
        title: "Rename a tab",
        description:
          "Gives a tab of the folder of this connection a new name, which changes its address and the addresses of " +
          "all pages in it. The wiki links into the tab in every page of the folder are changed to the new name in " +
          "the same change. A rename to the current name changes nothing. Returns the tab with its new address and " +
          `the pages whose links were updated. ${USER_TEXT_NOTE}`,
        inputSchema: renameTabInput,
        outputSchema: renamedTabOutput,
        annotations: WRITES,
      },
      (input) => renameTab(options, input),
    );
  }

  if (mayDo(role, "deleteTab")) {
    server.registerTool(
      "delete_tab",
      {
        title: "Delete a tab with all its pages and files",
        description:
          "Deletes a tab of the folder of this connection together with every page and every file (image or PDF) " +
          "in it, in one call and without a further confirmation. The tab is deleted for good and cannot be " +
          "restored. Its pages and files go to the deleted items of the folder and can only be restored one by one, " +
          "by a Manager or Owner of the folder in the browser. Use list_folder first to see which pages are in the " +
          "tab. Returns the number of pages deleted with the tab, the name and title of each, the name of each file " +
          "deleted with it, and the address of the deleted items of the folder. " +
          USER_TEXT_NOTE,
        inputSchema: deleteTabInput,
        outputSchema: deletedTabOutput,
        annotations: WRITES_AND_DELETES,
      },
      (input) => deleteTab(options, input),
    );
  }

  return server;
}
