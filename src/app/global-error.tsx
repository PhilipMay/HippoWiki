"use client";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import CssBaseline from "@mui/material/CssBaseline";
import Stack from "@mui/material/Stack";
import { ThemeProvider } from "@mui/material/styles";
import { useEffect } from "react";

import { pageTitle } from "@/lib/site";
import { theme } from "@/lib/theme";

/**
 * Shown when the root layout itself fails. It replaces the root layout, so it renders its own document, without the
 * app bar, which may be what failed.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String(error.digest) : undefined;

  return (
    <html lang="en">
      <body>
        <title>{pageTitle("Error")}</title>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <Container component="main" maxWidth="md" sx={{ py: 4 }}>
            <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
              <Alert severity="error" sx={{ alignSelf: "stretch" }}>
                <AlertTitle>Something went wrong</AlertTitle>
                An unexpected error occurred while loading HippoWiki.
                {digest && ` (Error ID: ${digest})`}
              </Alert>
              <Button variant="contained" onClick={() => retry()}>
                Try again
              </Button>
            </Stack>
          </Container>
        </ThemeProvider>
      </body>
    </html>
  );
}
