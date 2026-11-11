import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography, { type TypographyProps } from "@mui/material/Typography";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

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

function heading(tag: HeadingTag): Components[HeadingTag] {
  return function MarkdownHeading({ children, id }) {
    return (
      <Typography
        variant={headingVariants[tag]}
        component={tag}
        id={id}
        sx={{ mt: 3, mb: 1.5, fontWeight: 500, overflowWrap: "anywhere" }}
      >
        {children}
      </Typography>
    );
  };
}

const components: Components = {
  h1: heading("h1"),
  h2: heading("h2"),
  h3: heading("h3"),
  h4: heading("h4"),
  h5: heading("h5"),
  h6: heading("h6"),
  p: ({ children }) => (
    <Typography variant="body1" sx={{ mb: 2 }}>
      {children}
    </Typography>
  ),
  a: ({ children, href, title }) => (
    <MuiLink href={href} title={title}>
      {children}
    </MuiLink>
  ),
  blockquote: ({ children }) => (
    <Box
      component="blockquote"
      sx={{ mx: 0, my: 2, pl: 2, borderLeft: 4, borderColor: "divider", color: "text.secondary" }}
    >
      {children}
    </Box>
  ),
  table: ({ children }) => (
    <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
      <Table size="small">{children}</Table>
    </TableContainer>
  ),
  thead: ({ children }) => <TableHead>{children}</TableHead>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  // GFM column alignment arrives as an inline `text-align` style.
  th: ({ children, style }) => (
    <TableCell style={style} sx={{ fontWeight: 500 }}>
      {children}
    </TableCell>
  ),
  td: ({ children, style }) => <TableCell style={style}>{children}</TableCell>,
};

/**
 * Renders Markdown (with GitHub Flavored Markdown) as Material UI typography. Raw HTML inside the Markdown is not
 * rendered but shown as text, and unsafe link URLs such as `javascript:` are removed by react-markdown's defaults.
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
        "& ul.contains-task-list": { pl: 0 },
        "& li.task-list-item": { listStyle: "none" },
        "& li.task-list-item input": { mr: 1 },
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
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </Box>
  );
}
