// The known users of the development seed and of the tests, with their passwords. For development and tests only:
// the container image creates its admin from HIPPOWIKI_ADMIN_PASSWORD (see scripts/admin.ts) and contains neither
// this file nor the seed. Both users have the password change already done, so that a login leads straight to the
// content.

import type { UserType } from "../src/features/users/user-type";

export type KnownUser = { id: string; name: string; type: UserType; password: string };

/** The admin: manages the accounts and sees no content. */
export const KNOWN_ADMIN: KnownUser = {
  id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1001",
  name: "admin",
  type: "admin",
  password: "admin-password",
};

/** A user: works with the content. */
export const KNOWN_USER: KnownUser = {
  id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002",
  name: "alice",
  type: "user",
  password: "alice-password",
};

export const KNOWN_USERS: readonly KnownUser[] = [KNOWN_ADMIN, KNOWN_USER];
