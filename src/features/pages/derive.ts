// The pure helper that derives the title of a page; the name a title suggests is `deriveName()` of
// `src/lib/derive-name.ts`. Used by Client Components, so no server-only imports.

import { parseMarkdown, titleFromTokens } from "@/features/pages/markdown";

/**
 * Returns the page title of the Markdown content, or `null` if it has none: the text of a leading level-one ATX
 * heading (`# Title`), parsed as the page view parses it. The exact rule is `titleFromTokens()` in `markdown.ts`.
 * There is no fallback title: content without a title is refused by the schemas.
 */
export function titleFromContent(content: string): string | null {
  return titleFromTokens(content, parseMarkdown(content));
}
