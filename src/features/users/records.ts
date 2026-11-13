// The rows of a user, in the shape Better Auth expects: a `User` row and its credential `Account` row. Users are
// written with Prisma instead of through the sign-up of Better Auth, which stays disabled; this helper is the one
// place that knows the shape. The users service, the seed and the test helpers use it. It also gives the reads of
// folders, tabs and pages the name of their last editor. No server-only imports.

import type { Prisma } from "@/generated/prisma/client";

/**
 * What a read of a folder, tab or page selects of its last editor: the user name only, so that no other field of the
 * user reaches a caller.
 */
export const LAST_EDITOR_SELECT = { lastEditedBy: { select: { username: true } } } as const;

/** The last editor of a folder, tab or page as the reads return it, named as the users service names a user. */
export type LastEditor = { name: string };

/** The row of a read with its last editor as `LastEditor` instead of the selected user row. */
export function withLastEditor<Row extends { lastEditedBy: { username: string } }>({
  lastEditedBy,
  ...row
}: Row): Omit<Row, "lastEditedBy"> & { lastEditedBy: LastEditor } {
  return { ...row, lastEditedBy: { name: lastEditedBy.username } };
}

/** The `providerId` of the account that holds the password of a user, as Better Auth names it. */
export const CREDENTIAL_PROVIDER_ID = "credential";

/** The domain of the placeholder emails; `.invalid` is reserved and never resolves. */
const EMAIL_DOMAIN = "users.hippowiki.invalid";

/**
 * The hidden placeholder email of the user with the given name. Better Auth needs an email for each user; this one is
 * never shown and never gets mail.
 */
export function placeholderEmail(name: string): string {
  return `${name}@${EMAIL_DOMAIN}`;
}

export type NewUser = {
  /** The id of the user; a random one unless given. */
  id?: string;
  /** A valid user name (see `schema.ts`). */
  name: string;
  /** The encoded hash of the password, from `hashPassword()`. */
  passwordHash: string;
  /** Whether the password is a first password, which the user has to change at the first login. */
  mustChangePassword: boolean;
};

/**
 * The data of a new user for `user.create()` of Prisma: the `User` row and, nested, its credential `Account` row. The
 * id is set here instead of by the database, because the account refers to it in `accountId`.
 */
export function newUserData({
  id = crypto.randomUUID(),
  name,
  passwordHash,
  mustChangePassword,
}: NewUser): Prisma.UserCreateInput {
  return {
    id,
    // Better Auth needs a display name; the user name is the only name a user has.
    name,
    username: name,
    email: placeholderEmail(name),
    mustChangePassword,
    accounts: { create: { providerId: CREDENTIAL_PROVIDER_ID, accountId: id, password: passwordHash } },
  };
}
