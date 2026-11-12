// The reads and writes of user accounts. The service knows nothing about Next.js, forms or addresses, so that the GUI
// (through `queries.ts` and `actions.ts`), the admin setup script and any other caller can use it, also outside a
// request. It writes users with Prisma and the password hashing, not through Better Auth, and never logs a password.
//
// What a caller may do is checked here, not in the adapters, which another caller would not pass through: a function
// that is for the admin only takes the acting user as its first argument and decides itself whether it is the admin.

import { z } from "zod";

import { newUserData } from "@/features/users/records";
import { ADMIN_NAME, isAdmin, passwordSchemaFor, type PasswordFieldErrors } from "@/features/users/schema";
import { getDb } from "@/lib/db";
import { isUniqueViolation, USER_NAME } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { hashPassword, PasswordHashBusyError } from "@/lib/password-hash";
import type { Result } from "@/lib/result";

/**
 * The user on whose behalf a function is called. The adapters take it from the session of the request; the service
 * decides what it may do.
 */
export type Actor = { id: string; name: string };

/** A user as the user list shows it. */
export type UserSummary = {
  id: string;
  /** The user name. */
  name: string;
  createdAt: Date;
  /** Whether the user still has to replace the first password by an own one. */
  mustChangePassword: boolean;
};

/**
 * All users, by name, for the admin. For every other actor it returns `null` and does not ask the database: for them
 * the user list does not exist.
 */
export async function listUsers(actor: Actor): Promise<UserSummary[] | null> {
  if (!isAdmin(actor)) return null;
  const users = await getDb().user.findMany({
    select: { id: true, username: true, createdAt: true, mustChangePassword: true },
    orderBy: { username: "asc" },
  });
  return users.map(({ id, username, createdAt, mustChangePassword }) => ({
    id,
    name: username,
    createdAt,
    mustChangePassword,
  }));
}

/** What `ensureAdmin()` found or did: the admin was created, or it existed already. */
export type AdminSetup = { outcome: "created" | "exists" };

/** The admin has to be created and no password was given. */
type PasswordMissing = { code: "password-missing" };
type InvalidPassword = { code: "invalid-input"; fieldErrors: PasswordFieldErrors };
/** Too many password hashes are running; nothing was written. */
type Busy = { code: "busy" };
/** An unexpected error; it has been logged. */
type Failed = { code: "failed" };

export type EnsureAdminError = PasswordMissing | InvalidPassword | Busy | Failed;

/**
 * Makes sure that the admin account exists. If a user named `admin` exists, it does nothing and does not look at the
 * password. Otherwise it creates the admin with the given password, which has to follow the password rules and which
 * the admin must change at the first login.
 */
export async function ensureAdmin(password: string | undefined): Promise<Result<AdminSetup, EnsureAdminError>> {
  try {
    const admin = await getDb().user.findUnique({ where: { username: ADMIN_NAME }, select: { id: true } });
    if (admin) {
      logger.info({ userId: admin.id }, "admin exists, nothing to do");
      return { ok: true, value: { outcome: "exists" } };
    }
  } catch (err) {
    logger.error({ err }, "failed to look up the admin");
    return { ok: false, error: { code: "failed" } };
  }

  if (password === undefined || password === "") return { ok: false, error: { code: "password-missing" } };
  const parsed = passwordSchemaFor(ADMIN_NAME).safeParse(password);
  if (!parsed.success) {
    const fieldErrors = { password: z.flattenError(parsed.error).formErrors };
    return { ok: false, error: { code: "invalid-input", fieldErrors } };
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(parsed.data);
  } catch (err) {
    if (err instanceof PasswordHashBusyError) {
      logger.warn("too many password hashes are running, admin not created");
      return { ok: false, error: { code: "busy" } };
    }
    logger.error({ err }, "failed to hash the password of the admin");
    return { ok: false, error: { code: "failed" } };
  }

  let admin: { id: string };
  try {
    admin = await getDb().user.create({
      data: newUserData({ name: ADMIN_NAME, passwordHash, mustChangePassword: true }),
      select: { id: true },
    });
  } catch (err) {
    // Another process created the admin in the meantime, e.g. a second container that started together with this one.
    if (isUniqueViolation(err, USER_NAME)) {
      logger.info("admin was created in the meantime, nothing to do");
      return { ok: true, value: { outcome: "exists" } };
    }
    logger.error({ err }, "failed to create the admin");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ userId: admin.id }, "admin created");
  return { ok: true, value: { outcome: "created" } };
}
