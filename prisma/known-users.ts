// The known users of the development seed and of the tests, with their passwords. For development and tests only:
// the container image creates its admin from HIPPOWIKI_ADMIN_PASSWORD (see scripts/admin.ts) and contains neither
// this file nor the seed. Both users have the password change already done, so that a login leads straight to the
// content.

export type KnownUser = { id: string; name: string; password: string };

/** The admin: the user who can list and create users. */
export const KNOWN_ADMIN: KnownUser = {
  id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1001",
  name: "admin",
  password: "admin-password",
};

/** A normal user. */
export const KNOWN_USER: KnownUser = {
  id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002",
  name: "alice",
  password: "alice-password",
};

export const KNOWN_USERS: readonly KnownUser[] = [KNOWN_ADMIN, KNOWN_USER];
