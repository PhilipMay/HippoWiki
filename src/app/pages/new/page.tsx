import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";

import NewPageForm from "@/features/pages/components/NewPageForm";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("New page"),
};

export default function NewPagePage() {
  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        New page
      </Typography>
      <NewPageForm />
    </Stack>
  );
}
