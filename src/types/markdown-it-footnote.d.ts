// markdown-it-footnote ships no types, and `@types/markdown-it-footnote` is written for the types of markdown-it 14,
// while markdown-it 15 ships its own. The plugin is used only as a plugin of `markdown.ts`.
declare module "markdown-it-footnote" {
  import type { MarkdownIt } from "markdown-it";

  const footnote: (md: MarkdownIt) => void;
  export default footnote;
}
