// Turns the tokens of markdown-it into React elements with the Material UI components of the page view. Plain code of
// its own instead of the HTML renderer of markdown-it: text only ever reaches React as children, never as HTML, so
// there is no `dangerouslySetInnerHTML`, and the elements are the Material UI components of the rest of the app, except
// the rows and cells of tables, which are plain elements with the look of Material UI (`TABLE_STYLES`).

import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableContainer from "@mui/material/TableContainer";
import Typography, { type TypographyProps } from "@mui/material/Typography";
import { Fragment, type ReactNode } from "react";

import Link from "@/components/Link";
import {
  isWikiLink,
  type ListMeta,
  parseMarkdown,
  plainText,
  type TaskMeta,
  type Token,
} from "@/features/pages/markdown";
import type { WikiLinkResolution } from "@/features/pages/service";
import { wikiLinkTargetText } from "@/features/pages/wiki-link-target";
import { newPagePath, pagePath } from "@/lib/addresses";

/**
 * What the page view needs to show wiki links as links: the folder of the content, whether the user may create pages
 * there, and what the links lead to in the folder as it is now. Without it, a wiki link shows its plain text.
 */
export type WikiLinkContext = { folderName: string; mayCreatePages: boolean; resolution: WikiLinkResolution };

/**
 * The hints of a wiki link that leads to no page, for pointer users as the title of the element and for screen reader
 * users as its description, from an element of the page view that only describes (`WikiLinkHints`).
 */
const WIKI_LINK_HINTS = {
  missing: { id: "wiki-link-hint-missing", text: "Page does not exist" },
  invalid: { id: "wiki-link-hint-invalid", text: "Not a valid page name" },
  noTab: { id: "wiki-link-hint-no-tab", text: "Tab does not exist" },
} as const;

type WikiLinkHint = keyof typeof WIKI_LINK_HINTS;

/**
 * The mark of a wiki link that leads to no page: a color of its own and, as a cue that does not rely on color, a
 * dashed underline.
 */
const MISSING_LINK_STYLE = {
  color: "error.main",
  textDecorationLine: "underline",
  textDecorationStyle: "dashed",
  textUnderlineOffset: "0.2em",
} as const;

/**
 * The prefix of every id the page view gives an element. Ids of the content cannot then clobber a global of the DOM,
 * such as `window.location` through `id="location"`.
 */
const ID_PREFIX = "user-content-";

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

// Markdown headings keep their level, but are drawn two Typography sizes smaller than their tag: the content's title
// heading (`# Title`) is the visual top heading of the page view and takes the `h3` size that page titles have.
const headingVariants: Record<HeadingTag, TypographyProps["variant"]> = {
  h1: "h3",
  h2: "h4",
  h3: "h5",
  h4: "h6",
  h5: "subtitle1",
  h6: "subtitle1",
};

/** The value of an attribute of a token, or `undefined`. */
function attribute(token: Token, name: string): string | undefined {
  const value = token.attrGet(name);
  return value === null ? undefined : String(value);
}

/** The alignment of a table cell, which markdown-it gives as the attribute `style="text-align:…"`. */
function textAlign(token: Token): "left" | "right" | "center" | undefined {
  const match = /^text-align:(left|right|center)$/.exec(attribute(token, "style") ?? "");
  return match?.[1] as "left" | "right" | "center" | undefined;
}

/** The class of a table cell with an alignment, styled by `TABLE_STYLES`. */
function alignClass(token: Token): string | undefined {
  const align = textAlign(token);
  return align && `align-${align}`;
}

/**
 * The styles of the cells of a table, set once at the table: the look of the small `TableCell` of Material UI. The rows
 * and cells are plain elements, because a `TableCell` costs about five times as much to render, and the page view of a
 * table can have about 66,000 cells (markdown-it fills rows up to the columns of the header, up to 65,536 cells).
 */
const TABLE_STYLES = {
  "& th, & td": {
    typography: "body2",
    color: "text.primary",
    verticalAlign: "inherit",
    textAlign: "left",
    padding: "6px 16px",
    borderBottom: "1px solid var(--mui-palette-TableCell-border)",
  },
  "& th": { lineHeight: "1.5rem", fontWeight: 500 },
  "& .align-left": { textAlign: "left" },
  "& .align-center": { textAlign: "center" },
  "& .align-right": { textAlign: "right" },
} as const;

/** The number of a footnote as the reader sees it, from the `id` that markdown-it-footnote counts from 0. */
function footnoteNumber(token: Token): number {
  return (token.meta as { id: number }).id + 1;
}

/** The id suffix of a reference to a footnote: its number, and from the second reference on a running count. */
function footnoteReferenceId(token: Token): string {
  const { subId } = token.meta as { subId?: number };
  return subId ? `${footnoteNumber(token)}-${subId + 1}` : `${footnoteNumber(token)}`;
}

/** The element of an opening token with the children converted from the tokens up to its closing token. */
function containerElement(open: Token, children: ReactNode[], key: string): ReactNode {
  switch (open.type) {
    case "heading_open": {
      const tag = open.tag as HeadingTag;
      return (
        <Typography
          key={key}
          variant={headingVariants[tag]}
          component={tag}
          sx={{ mt: 3, mb: 1.5, fontWeight: 500, overflowWrap: "anywhere" }}
        >
          {children}
        </Typography>
      );
    }
    case "paragraph_open":
      // markdown-it hides the paragraphs of a tight list; their text goes straight into the list item.
      return open.hidden ? (
        <Fragment key={key}>{children}</Fragment>
      ) : (
        <Typography key={key} variant="body1" sx={{ mb: 2 }}>
          {children}
        </Typography>
      );
    case "blockquote_open":
      return (
        <Box
          key={key}
          component="blockquote"
          sx={{ mx: 0, my: 2, pl: 2, borderLeft: 4, borderColor: "divider", color: "text.secondary" }}
        >
          {children}
        </Box>
      );
    case "bullet_list_open":
      return (
        <ul key={key} className={(open.meta as ListMeta | null)?.containsTasks ? "contains-task-list" : undefined}>
          {children}
        </ul>
      );
    case "ordered_list_open": {
      const start = Number(attribute(open, "start") ?? 1);
      return (
        <ol
          key={key}
          start={start === 1 ? undefined : start}
          className={(open.meta as ListMeta | null)?.containsTasks ? "contains-task-list" : undefined}
        >
          {children}
        </ol>
      );
    }
    case "list_item_open": {
      const task = (open.meta as TaskMeta | null)?.task;
      if (!task) return <li key={key}>{children}</li>;
      return (
        <li key={key} className="task-list-item">
          <input type="checkbox" disabled defaultChecked={task.checked} />
          {children}
        </li>
      );
    }
    case "table_open":
      return (
        <TableContainer key={key} component={Paper} variant="outlined" sx={{ mb: 2 }}>
          <Table size="small" sx={TABLE_STYLES}>
            {children}
          </Table>
        </TableContainer>
      );
    case "thead_open":
      return <thead key={key}>{children}</thead>;
    case "tbody_open":
      return <tbody key={key}>{children}</tbody>;
    case "tr_open":
      return <tr key={key}>{children}</tr>;
    case "th_open":
      return (
        <th key={key} scope="col" className={alignClass(open)}>
          {children}
        </th>
      );
    case "td_open":
      return (
        <td key={key} className={alignClass(open)}>
          {children}
        </td>
      );
    case "em_open":
      return <em key={key}>{children}</em>;
    case "strong_open":
      return <strong key={key}>{children}</strong>;
    case "s_open":
      return <del key={key}>{children}</del>;
    case "link_open":
      // `validateLink` in `markdown.ts` lets only safe addresses become links.
      return (
        <MuiLink key={key} href={attribute(open, "href")} title={attribute(open, "title")}>
          {children}
        </MuiLink>
      );
    case "footnote_block_open":
      return (
        <Box
          key={key}
          component="section"
          className="footnotes"
          aria-labelledby={`${ID_PREFIX}footnote-label`}
          sx={{ mt: 3, pt: 1, borderTop: 1, borderColor: "divider", "& li > p": { mb: 0.5 } }}
        >
          <Typography variant="subtitle1" component="h2" id={`${ID_PREFIX}footnote-label`} sx={{ fontWeight: 500 }}>
            Footnotes
          </Typography>
          <ol>{children}</ol>
        </Box>
      );
    case "footnote_open":
      return (
        <li key={key} id={`${ID_PREFIX}fn-${footnoteNumber(open)}`}>
          {children}
        </li>
      );
    default:
      // A container this renderer does not know keeps its content.
      return <Fragment key={key}>{children}</Fragment>;
  }
}

/**
 * The element of a wiki link: a link to the page it names, with its label or the current title of the page; for a
 * missing page in an existing place, a marked link to the editor of a new page with its name and place for a user who
 * may create pages, and marked text for anyone else; and marked text for every role when the target breaks the name
 * rule or names a tab that does not exist. Every address is built from names that follow the name rule, and the label
 * and the title are children, so they reach the page as text.
 */
function wikiLinkElement(token: Token, key: string, links: WikiLinkContext | undefined): ReactNode {
  if (!links || !isWikiLink(token)) return token.content;
  const { page, label, target } = token.meta;
  if (page === null) return missingText(key, label ?? target, "invalid");
  const title = links.resolution.titles.get(wikiLinkTargetText(page));
  if (title !== undefined) {
    return (
      <MuiLink key={key} component={Link} href={pagePath(links.folderName, page.tab, page.name)}>
        {label ?? title}
      </MuiLink>
    );
  }
  if (page.tab !== null && !links.resolution.tabs.has(page.tab)) return missingText(key, label ?? target, "noTab");
  if (!links.mayCreatePages) return missingText(key, label ?? target, "missing");
  return (
    <MuiLink
      key={key}
      component={Link}
      href={newPagePath(links.folderName, page.tab, page.name)}
      title={WIKI_LINK_HINTS.missing.text}
      aria-describedby={WIKI_LINK_HINTS.missing.id}
      sx={MISSING_LINK_STYLE}
    >
      {label ?? target}
    </MuiLink>
  );
}

/** The marked text of a wiki link that is no link, with its hint. */
function missingText(key: string, text: string, hint: WikiLinkHint): ReactNode {
  return (
    <Box
      key={key}
      component="span"
      title={WIKI_LINK_HINTS[hint].text}
      aria-describedby={WIKI_LINK_HINTS[hint].id}
      sx={MISSING_LINK_STYLE}
    >
      {text}
    </Box>
  );
}

/**
 * The hidden texts that the marked wiki links name as their description. Hidden elements are not read on their own,
 * but they still describe the elements that point to them.
 */
function WikiLinkHints(): ReactNode {
  return (
    <>
      {Object.values(WIKI_LINK_HINTS).map(({ id, text }) => (
        <span key={id} id={id} hidden>
          {text}
        </span>
      ))}
    </>
  );
}

/** The element of a token without children of its own in the token list. */
function leafElement(token: Token, key: string, links: WikiLinkContext | undefined): ReactNode {
  switch (token.type) {
    case "text":
    case "text_special":
      return token.content;
    case "softbreak":
      return "\n";
    case "hardbreak":
      return <br key={key} />;
    case "code_inline":
      return <code key={key}>{token.content}</code>;
    case "wiki_link":
      return wikiLinkElement(token, key, links);
    case "code_block":
    case "fence": {
      const language = token.info.trim().split(/\s+/)[0];
      return (
        <pre key={key}>
          <code className={language ? `language-${language}` : undefined}>{token.content}</code>
        </pre>
      );
    }
    case "hr":
      return <hr key={key} />;
    case "image":
      // `validateLink` in `markdown.ts` lets only safe addresses become images, so a `data:` image stays text. An
      // image of another host is blocked by the browser through the Content Security Policy (see "Security headers"
      // in `architecture.md`). `Box` renders the `img` element, because the lint rules of Next.js report a plain
      // `<img>`.
      return (
        <Box
          key={key}
          component="img"
          src={attribute(token, "src")}
          alt={plainText(token.children ?? [])}
          title={attribute(token, "title")}
        />
      );
    case "inline":
      return <Fragment key={key}>{tokensToReact(token.children ?? [], `${key}.`, links)}</Fragment>;
    case "footnote_ref": {
      const number = footnoteNumber(token);
      return (
        <sup key={key}>
          <MuiLink
            href={`#${ID_PREFIX}fn-${number}`}
            id={`${ID_PREFIX}fnref-${footnoteReferenceId(token)}`}
            aria-describedby={`${ID_PREFIX}footnote-label`}
          >
            {number}
          </MuiLink>
        </sup>
      );
    }
    case "footnote_anchor":
      return (
        <Fragment key={key}>
          {" "}
          <MuiLink
            href={`#${ID_PREFIX}fnref-${footnoteReferenceId(token)}`}
            aria-label={`Back to reference ${footnoteReferenceId(token)}`}
          >
            ↩
          </MuiLink>
        </Fragment>
      );
    default:
      // A token this renderer does not know shows its source text, never HTML.
      return token.content || null;
  }
}

/**
 * Converts a flat list of tokens, in which opening and closing tokens nest, into React elements. Uses a stack of its
 * own instead of recursion, so that the nesting of the content does not deepen the call stack; only the inline
 * tokens of a block are converted by a call of their own. A missing closing token closes its element at the end.
 */
function tokensToReact(tokens: readonly Token[], keyPrefix: string, links: WikiLinkContext | undefined): ReactNode[] {
  const root: ReactNode[] = [];
  const open: { token: Token; children: ReactNode[]; key: string }[] = [];
  let children = root;
  const close = () => {
    const frame = open.pop()!;
    children = open.at(-1)?.children ?? root;
    children.push(containerElement(frame.token, frame.children, frame.key));
  };
  tokens.forEach((token, index) => {
    const key = `${keyPrefix}${index}`;
    if (token.nesting === 1) {
      open.push({ token, children: [], key });
      children = open.at(-1)!.children;
    } else if (token.nesting === -1) {
      if (open.length > 0) close();
    } else {
      children.push(leafElement(token, key, links));
    }
  });
  while (open.length > 0) close();
  return root;
}

/**
 * Parses Markdown and returns the React elements of the page view, with the wiki links as links where `links` is
 * given. Throws if the parse or the conversion fails.
 */
export function markdownToReact(content: string, links?: WikiLinkContext): ReactNode {
  const elements = tokensToReact(parseMarkdown(content), "", links);
  return links ? [...elements, <WikiLinkHints key="wiki-link-hints" />] : elements;
}
