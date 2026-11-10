"use client";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useEffect } from "react";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String(error.digest) : undefined;

  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <Alert severity="error" sx={{ alignSelf: "stretch" }}>
        <AlertTitle>Something went wrong</AlertTitle>
        An unexpected error occurred while loading this page.
        {digest && ` (Error ID: ${digest})`}
      </Alert>
      <Button variant="contained" onClick={() => retry()}>
        Try again
      </Button>
    </Stack>
  );
}
