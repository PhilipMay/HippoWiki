// The target of a wiki link (`[[target]]` or `[[target|label]]`): the name of a page as its address names it, `name`
// for a page placed directly in the folder and `tab/name` for a page in a tab. A module without imports of Zod or
// markdown-it, so that the Markdown editor can read targets with the same rule as the page view.

import { NAME_MAX_LENGTH, NAME_PATTERN } from "@/lib/name-limits";

/**
 * The page a valid target names in the folder of the linking page: the name of its tab, or `null` for a page placed
 * directly in the folder, and its name. A target never names another folder: the first part of `tab/name` is always a
 * tab of the own folder.
 */
export type WikiLinkTarget = { tab: string | null; name: string };

/** Whether the text is a name of a tab or page, written exactly: the name rule of `src/lib/names.ts` and its limit. */
function isName(text: string): boolean {
  return text.length <= NAME_MAX_LENGTH && NAME_PATTERN.test(text);
}

/**
 * Reads a target as written: a page name, or a tab name, one `/` and a page name, each following the name rule and
 * written exactly as the name is stored. Anything else, such as upper case, spaces, `.md`, a `#` or a second `/`, is a
 * target that breaks the rule and gives `null`.
 */
export function parseWikiLinkTarget(text: string): WikiLinkTarget | null {
  const parts = text.split("/");
  if (parts.length === 1) return isName(text) ? { tab: null, name: text } : null;
  if (parts.length !== 2) return null;
  const [tab = "", name = ""] = parts;
  return isName(tab) && isName(name) ? { tab, name } : null;
}

/** The target as a wiki link writes it: `name`, or `tab/name` for a page in a tab. */
export function wikiLinkTargetText(target: WikiLinkTarget): string {
  return target.tab === null ? target.name : `${target.tab}/${target.name}`;
}

/**
 * Why a wiki link leads to no page, the hints of the page view and of live preview: the page does not exist, the target
 * breaks the name rule, or it names a tab that does not exist.
 */
export const MISSING_WIKI_LINK_HINTS = {
  missing: "Page does not exist",
  invalid: "Not a valid page name",
  noTab: "Tab does not exist",
} as const;
