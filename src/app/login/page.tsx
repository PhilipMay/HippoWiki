import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { logIn } from "@/features/auth/actions";
import LoginForm from "@/features/auth/components/LoginForm";
import { getCurrentUser } from "@/features/auth/session";
import { changePasswordPath, NEXT_PARAM, parseAction, parseView, safeNextPath } from "@/lib/addresses";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Log in"),
};

/**
 * The login page: the one page that needs no login. With `?next=<path>` the login leads to that path instead of the
 * folders, e.g. back to the address that asked for the login (`src/proxy.ts`).
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const query = await searchParams;
  // The login page has no actions and no views; the way back is neither.
  if (parseAction(query, []) !== null || parseView(query) !== null) notFound();
  // Only a path on this site; anything else is the folder list.
  const next = safeNextPath(query[NEXT_PARAM]);

  // Who is logged in already has nothing to do here and goes on.
  const user = await getCurrentUser();
  if (user) redirect(user.mustChangePassword ? changePasswordPath(next) : next);

  return (
    <Stack spacing={3} sx={{ maxWidth: 400, mx: "auto" }}>
      <Typography variant="h4" component="h1">
        Log in
      </Typography>
      <LoginForm action={logIn} next={next} />
    </Stack>
  );
}
