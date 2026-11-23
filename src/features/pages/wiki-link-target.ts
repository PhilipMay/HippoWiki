// The target of a wiki link (`[[target]]`, `[[target|label]]` and, for a file, `![[target]]`): the name of a page or a
// file as its address names it, `name` for a page placed directly in the folder, `tab/name` for a page in a tab,
// `name.ext` and `tab/name.ext` for a file. A module without imports of Zod or markdown-it, so that the Markdown editor
// can read targets with the same rule as the page view.

import { FILE_NAME_PATTERN, NAME_MAX_LENGTH, NAME_PATTERN } from "@/lib/name-limits";

/**
 * The page or file a valid target names in the folder of the linking page: what it names, the name of its tab, or
 * `null` for an item placed directly in the folder, and its name, for a file with its extension. A target never names
 * another folder: the first part of `tab/name` is always a tab of the own folder.
 */
export type WikiLinkTarget = { kind: "page" | "file"; tab: string | null; name: string };

/** Whether the text is a name of a tab or page, written exactly: the name rule of `src/lib/names.ts` and its limit. */
function isName(text: string): boolean {
  return text.length <= NAME_MAX_LENGTH && NAME_PATTERN.test(text);
}

/**
 * Whether the text is a name of a file, written exactly: a name, a dot and one of the extensions of the files
 * (`FILE_NAME_PATTERN`), with the length limit of a name before the dot.
 */
function isFileName(text: string): boolean {
  return text.lastIndexOf(".") <= NAME_MAX_LENGTH && FILE_NAME_PATTERN.test(text);
}

/** What the last part of a target names: a page by its name, a file by its name with the extension, or nothing. */
function kindOf(text: string): WikiLinkTarget["kind"] | null {
  if (isName(text)) return "page";
  return isFileName(text) ? "file" : null;
}

/**
 * Reads a target as written: a page name or a file name, or a tab name, one `/` and a page or file name, each following
 * the name rule and written exactly as the name is stored. A last part with one of the extensions of the files names a
 * file, one without an extension a page. Anything else, such as upper case, spaces, `.md`, `.jpeg`, another
 * extension, a `#` or a second `/`, is a target that breaks the rule and gives `null`.
 */
export function parseWikiLinkTarget(text: string): WikiLinkTarget | null {
  const parts = text.split("/");
  if (parts.length > 2) return null;
  const [first = "", second] = parts;
  const tab = second === undefined ? null : first;
  const name = second ?? first;
  if (tab !== null && !isName(tab)) return null;
  const kind = kindOf(name);
  return kind === null ? null : { kind, tab, name };
}

/** The target as a wiki link writes it: `name`, or `tab/name` for an item in a tab. */
export function wikiLinkTargetText(target: { tab: string | null; name: string }): string {
  return target.tab === null ? target.name : `${target.tab}/${target.name}`;
}

/**
 * The wiki link of a page or file, `[[target]]`, without a label: the link with which a page links it, as the copy
 * field "Wiki link" of the details page of a file and the results of the MCP tools give it.
 */
export function wikiLinkOf(target: { tab: string | null; name: string }): string {
  return `[[${wikiLinkTargetText(target)}]]`;
}

/**
 * The embed link of a file, `![[target]]`, without a label: the link with which a page shows an image, as the copy
 * field "Embed link" of the details page of an image and the results of the MCP tools give it.
 */
export function embedLinkOf(target: { tab: string | null; name: string }): string {
  return `![[${wikiLinkTargetText(target)}]]`;
}

/**
 * Why a wiki link leads to no page or file, the hints of the page view and of live preview: the page or the file does
 * not exist, the target breaks the name rule, or it names a tab that does not exist.
 */
export const MISSING_WIKI_LINK_HINTS = {
  missing: "Page does not exist",
  missingFile: "File does not exist",
  invalid: "Not a valid page name",
  noTab: "Tab does not exist",
} as const;
