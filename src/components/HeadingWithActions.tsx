import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

type HeadingWithActionsProps = {
  /** The heading of the address, e.g. the name of a folder or tab. */
  title: string;
  /** A line below the heading, e.g. the role of the user on the folder. */
  subtitle?: ReactNode;
  /** The buttons of the address: only what the role of the user includes. */
  children: ReactNode;
};

/** The head of an address with a row of buttons next to its heading, as the folder and tab addresses show it. */
export default function HeadingWithActions({ title, subtitle, children }: HeadingWithActionsProps) {
  return (
    // The buttons move below the heading and wrap on narrow screens instead of overflowing.
    <Stack
      direction="row"
      useFlexGap
      sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}
    >
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Typography variant="h4" component="h1" sx={{ overflowWrap: "anywhere" }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Stack>
      <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 2 }}>
        {children}
      </Stack>
    </Stack>
  );
}
