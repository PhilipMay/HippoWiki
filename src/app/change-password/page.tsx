import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { changeFirstPassword } from "@/features/auth/actions";
import ChangePasswordForm from "@/features/auth/components/ChangePasswordForm";
import { requireSession } from "@/features/auth/session";
import { foldersPath, parseAction, parseView } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Change password"),
};

/**
 * The forced password change: whoever logged in with a first password sets a password of their own here before doing
 * anything else. Every other address leads here while the change is pending.
 */
export default async function ChangePasswordPage({ searchParams }: PageProps<"/change-password">) {
  // Not `requireUser()`, which would redirect to this page.
  const user = await requireSession();

  const query = await searchParams;
  // The password change has no actions and no views.
  if (parseAction(query, []) !== null || parseView(query) !== null) notFound();

  // Without a pending change there is nothing to do here.
  if (!user.mustChangePassword) redirect(foldersPath());

  return (
    <Stack spacing={3} sx={{ maxWidth: 400, mx: "auto" }}>
      <Typography variant="h4" component="h1">
        Change password
      </Typography>
      <Typography>
        You logged in with a first password. Set a password of your own to continue. Your other sessions are logged out.
      </Typography>
      <ChangePasswordForm action={changeFirstPassword} />
    </Stack>
  );
}
