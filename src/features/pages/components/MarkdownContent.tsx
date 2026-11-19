import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import { markdownToReact } from "@/features/pages/components/markdownToReact";
import { logger } from "@/lib/logger";

/**
 * The page view of the content, or its source as text if parsing or converting it fails, so that the page and its
 * actions stay usable. The error is logged without the content.
 */
function renderContent(content: string): ReactNode {
  try {
    return markdownToReact(content);
  } catch (err) {
    logger.error({ err }, "markdown could not be rendered");
    return <pre>{content}</pre>;
  }
}

/**
 * Renders Markdown, parsed by markdown-it with the features of GitHub Flavored Markdown that `markdown.ts` sets up, as
 * Material UI typography. Raw HTML inside the Markdown is shown as text, and a link or image with an unsafe address,
 * such as `javascript:`, stays its Markdown text.
 */
export default function MarkdownContent({ children }: { children: string }) {
  return (
    // `sx` must be a plain object: this is a Server Component, and functions cannot be passed to Client Components.
    <Box
      sx={{
        "& > :first-child": { mt: 0 },
        "& ul, & ol": { pl: 3, mt: 0, mb: 2 },
        "& li > ul, & li > ol": { mb: 0 },
        "& li": { typography: "body1", mb: 0.5 },
        "& li > p": { mb: 0.5 },
        // Task lists keep the indent of other lists. In a bullet list, the checkbox takes the place of the bullet: its
        // negative margin equals its width and right margin, so the text starts where the text of a plain item does.
        // A task item of an ordered list keeps its number, with the checkbox in front of the text. Without a vertical
        // margin, the checkbox keeps a task item as high as a plain item.
        "& li.task-list-item > input": { width: 16, height: 16, my: 0, mr: 1, verticalAlign: "-0.2em" },
        "& ul > li.task-list-item": { listStyle: "none" },
        "& ul > li.task-list-item > input": { ml: -3 },
        "& code": {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: "0.875em",
          bgcolor: "action.hover",
          px: 0.5,
          py: 0.25,
          borderRadius: 0.5,
        },
        "& pre": {
          bgcolor: "action.hover",
          p: 2,
          mt: 0,
          mb: 2,
          borderRadius: 1,
          overflowX: "auto",
        },
        "& pre code": { bgcolor: "transparent", p: 0, fontSize: "0.875rem" },
        "& hr": { border: 0, borderTop: 1, borderColor: "divider", my: 3 },
        "& img": { maxWidth: "100%" },
      }}
    >
      {renderContent(children)}
    </Box>
  );
}
