import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { logIn } from "@/features/auth/actions";
import LoginForm from "@/features/auth/components/LoginForm";
import { getCurrentUser } from "@/features/auth/session";
import { changePasswordPath, foldersPath, parseAction, parseView } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Log in"),
};

/** The login page: the one page that needs no login. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const query = await searchParams;
  // The login page has no actions and no views.
  if (parseAction(query, []) !== null || parseView(query) !== null) notFound();

  // Who is logged in already has nothing to do here.
  const user = await getCurrentUser();
  if (user) redirect(user.mustChangePassword ? changePasswordPath() : foldersPath());

  return (
    <Stack spacing={3} sx={{ maxWidth: 400, mx: "auto" }}>
      <Typography variant="h4" component="h1">
        Log in
      </Typography>
      <LoginForm action={logIn} />
    </Stack>
  );
}
