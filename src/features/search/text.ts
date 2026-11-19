// The text of a page that search stores and the prose its language is detected from, both from the tokens of the one
// Markdown parser (`src/features/pages/markdown.ts`). Pure: no database and no server-only imports.

import { parseMarkdown, titleFromTokens, type Token } from "@/features/pages/markdown";

/** What search derives of the text of a page. */
export type PageText = {
  /**
   * The content as plain text, without the title heading, which the vector holds by itself: the text of every block,
   * the text of code blocks and inline code and the addresses of links and images included, one block per line. It
   * holds no control character but the line break, so that the marker characters of the pieces of text never occur
   * in it.
   */
  searchText: string;
  /**
   * The title and the text without code blocks, inline code and addresses, which lead a language detector astray. A
   * bare link, whose text is its address, adds nothing either.
   */
  prose: string;
};

/** Every control character; the text of a block keeps none, so the line breaks between blocks are the only ones. */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

/** The text of one block, both for the search text and for the prose. */
type BlockText = { search: string; prose: string };

/**
 * The text of the inline tokens of a block: text, inline code and the alt text of images, with the addresses of links
 * and images between spaces; line breaks become spaces. Walks with a stack of its own like `plainText()`, so that
 * nested images cannot deepen the call stack.
 */
function inlineText(tokens: readonly Token[]): BlockText {
  let search = "";
  let prose = "";
  // Inside a bare link, whose text is its address: the text is searched, but it is no prose.
  let inBareLink = false;
  const pending: Token[] = [...tokens].reverse();
  for (let token = pending.pop(); token !== undefined; token = pending.pop()) {
    switch (token.type) {
      case "text":
      case "text_special":
        search += token.content;
        if (!inBareLink) prose += token.content;
        break;
      case "code_inline":
        search += token.content;
        prose += " ";
        break;
      case "softbreak":
      case "hardbreak":
        search += " ";
        prose += " ";
        break;
      case "link_open":
        search += ` ${token.attrGet("href") ?? ""} `;
        inBareLink = token.markup === "linkify";
        break;
      case "link_close":
        inBareLink = false;
        break;
      case "image":
        search += ` ${token.attrGet("src") ?? ""} `;
        // A loop instead of `push(...children)`, which fails for more children than a call takes arguments.
        for (const child of [...(token.children ?? [])].reverse()) pending.push(child);
        break;
    }
  }
  return { search, prose };
}

/** Replaces the control characters of the text by spaces and trims it. */
function clean(text: string): string {
  return text.replace(CONTROL_CHARACTERS, " ").trim();
}

/** Derives the search text and the prose of the given Markdown content (see `PageText`). */
export function pageText(content: string): PageText {
  const tokens = parseMarkdown(content);
  const title = titleFromTokens(content, tokens);
  const search: string[] = [];
  const prose: string[] = title === null ? [] : [title];
  for (const [index, token] of tokens.entries()) {
    // The inline token of the title heading, which `titleFromTokens()` found as the first block.
    if (title !== null && index === 1) continue;
    if (token.type === "inline") {
      const text = inlineText(token.children ?? []);
      search.push(clean(text.search));
      prose.push(clean(text.prose));
    } else if (token.type === "fence" || token.type === "code_block") {
      search.push(clean(token.content));
    }
  }
  return {
    searchText: search.filter((text) => text !== "").join("\n"),
    prose: prose.filter((text) => text !== "").join("\n"),
  };
}
