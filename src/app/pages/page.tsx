import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";

import Link from "@/components/Link";
import PageList from "@/features/pages/components/PageList";
import { listPages } from "@/features/pages/queries";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Pages"),
};

export default async function PagesPage() {
  const pages = await listPages();

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h4" component="h1">
          Pages
        </Typography>
        <Button component={Link} href="/pages/new" variant="contained">
          New page
        </Button>
      </Stack>
      <PageList pages={pages} />
    </Stack>
  );
}
