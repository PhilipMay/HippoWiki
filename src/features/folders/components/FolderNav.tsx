import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";

import Link from "@/components/Link";
import type { TabSummary } from "@/features/folders/queries";
import { allPagesPath, folderPath, tabPath } from "@/lib/addresses";

type FolderNavProps = {
  folderName: string;
  /** The tabs of the folder, in display order. */
  tabs: TabSummary[];
  /** The entry that is shown: the folder itself, the tab with this name or the list of all pages. */
  current: "folder" | "all" | { tab: string };
};

/** One entry of the navigation bar; the current one is marked with `aria-current` and underlined. */
function NavEntry({ href, current, children }: { href: string; current: boolean; children: string }) {
  return (
    <Button
      component={Link}
      href={href}
      aria-current={current ? "page" : undefined}
      color={current ? "primary" : "inherit"}
      sx={{
        borderRadius: 0,
        borderBottom: 2,
        borderColor: current ? "primary.main" : "transparent",
        textTransform: "none",
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </Button>
  );
}

/**
 * The navigation bar of a folder: the folder itself first, then its tabs by name and "All pages" last, each a link,
 * and the "New tab" button. It is shown on the folder address and on the addresses of its tabs.
 */
export default function FolderNav({ folderName, tabs, current }: FolderNavProps) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: "flex-end", justifyContent: "space-between", borderBottom: 1, borderColor: "divider" }}
    >
      <Stack component="nav" aria-label="Folder" direction="row" sx={{ flexWrap: "wrap", columnGap: 1 }}>
        <NavEntry href={folderPath(folderName)} current={current === "folder"}>
          {folderName}
        </NavEntry>
        {tabs.map((tab) => (
          <NavEntry
            key={tab.id}
            href={tabPath(folderName, tab.name)}
            current={typeof current === "object" && current.tab === tab.name}
          >
            {tab.name}
          </NavEntry>
        ))}
        <NavEntry href={allPagesPath(folderName)} current={current === "all"}>
          All pages
        </NavEntry>
      </Stack>
      <Button component={Link} href={folderPath(folderName, "new-tab")} size="small" sx={{ flexShrink: 0, mb: 0.5 }}>
        New tab
      </Button>
    </Stack>
  );
}
