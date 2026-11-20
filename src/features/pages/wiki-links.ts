// The wiki links of the content of a page, from the one Markdown parser (`markdown.ts`): what the index of links
// stores, and where the target of each link stands in the content. Pure, without server-only imports.

import { isWikiLink, parseMarkdown } from "@/features/pages/markdown";
import { wikiLinkTargetText, type WikiLinkTarget } from "@/features/pages/wiki-link-target";

/**
 * The version of how the links of a page are derived for the index of links (`PageLink`). Count it up with every change
 * of the parse or of `linkTargetsOf()` that changes what they derive: the server then derives every page whose stored
 * version differs again before it serves.
 */
export const LINK_INDEX_VERSION = 1;

/** A wiki link of the content. */
export type WikiLink = {
  /** The target as written. */
  target: string;
  /** The page the target names, or `null` for a target that breaks the name rule. */
  page: WikiLinkTarget | null;
  /** The label as written, or `null` without one. */
  label: string | null;
  /**
   * Where the target starts in the content, so that a rewrite replaces exactly the target; `null` only where the parse
   * could not place it, which the tests rule out for every kind of block.
   */
  position: number | null;
};

/** The starts of the lines of the text, for line breaks as `\n`, `\r\n` or `\r`, as markdown-it counts lines. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (const match of text.matchAll(/\r\n?|\n/g)) starts.push(match.index + match[0].length);
  return starts;
}

/**
 * Turns a position in the source as markdown-it normalises it (every line break `\n`) into one in the content as
 * written, which may hold `\r\n` or `\r`.
 */
function positionInContent(content: string): (position: number) => number {
  if (!content.includes("\r")) return (position) => position;
  const normalised = lineStarts(content.replace(/\r\n?/g, "\n"));
  const written = lineStarts(content);
  return (position) => {
    let low = 0;
    let high = normalised.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (normalised[middle]! <= position) low = middle;
      else high = middle - 1;
    }
    return written[low]! + position - normalised[low]!;
  };
}

/** The wiki links of the content, in their order. A link inside the alt text of an image is no link. */
export function wikiLinksOf(content: string): WikiLink[] {
  const toContent = positionInContent(content);
  const links: WikiLink[] = [];
  for (const token of parseMarkdown(content)) {
    if (token.type !== "inline") continue;
    for (const child of token.children ?? []) {
      if (!isWikiLink(child)) continue;
      const { target, page, label, position } = child.meta;
      links.push({ target, page, label, position: position === null ? null : toContent(position) });
    }
  }
  return links;
}

/**
 * The targets of the content that the index of links stores: each valid target once, in the order of its first link. A
 * target that breaks the name rule names no page and is left out; a link of the page to itself is kept.
 */
export function linkTargetsOf(content: string): WikiLinkTarget[] {
  const targets = new Map<string, WikiLinkTarget>();
  for (const { page } of wikiLinksOf(content)) {
    if (page && !targets.has(wikiLinkTargetText(page))) targets.set(wikiLinkTargetText(page), page);
  }
  return [...targets.values()];
}

/** The rows of the index of links of a page of the given folder with the given content, without the page. */
export function linkRowsOf(
  content: string,
  folderId: string,
): { folderId: string; tabName: string | null; pageName: string }[] {
  return linkTargetsOf(content).map(({ tab, name }) => ({ folderId, tabName: tab, pageName: name }));
}
