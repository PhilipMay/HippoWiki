import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";

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
      <Typography variant="h4" component="h1">
        Pages
      </Typography>
      <PageList pages={pages} />
    </Stack>
  );
}
