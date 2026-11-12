// The single Better Auth instance. Better Auth handles the login, the sessions, the session cookie and the logout; it
// is called only on the server, as `auth.api` from the auth service (`src/features/auth/service.ts`). Its route
// handler is not mounted, so there is no public endpoint to sign up or to sign in.
import { randomBytes } from "node:crypto";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins/username";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USER_NAME_MAX_LENGTH,
  USER_NAME_MIN_LENGTH,
} from "@/features/users/schema";
import { getDb } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { NAME_PATTERN } from "@/lib/names";
import { hashPassword, verifyPassword } from "@/lib/password-hash";

/** A session lasts 30 days from the login and is not extended by use. */
export const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30;

/** The id of the one row of `AuthSecret`. */
const SECRET_ROW_ID = 1;

/**
 * The secret that signs the session cookies, from the single row of `AuthSecret`. When there is no row yet, it stores
 * 32 random bytes. A row that another process inserted at the same time wins: the conflict is ignored and the row is
 * read again, so that all processes sign with the same secret.
 */
async function readSecret(): Promise<string> {
  const db = getDb();
  const where = { id: SECRET_ROW_ID };
  const existing = await db.authSecret.findUnique({ where, select: { secret: true } });
  if (existing) return existing.secret;

  await db.authSecret.createMany({
    data: [{ id: SECRET_ROW_ID, secret: randomBytes(32).toString("hex") }],
    skipDuplicates: true,
  });
  const stored = await db.authSecret.findUniqueOrThrow({ where, select: { secret: true } });
  return stored.secret;
}

function createAuth(secret: string) {
  return betterAuth({
    secret,
    database: prismaAdapter(getDb(), { provider: "postgresql" }),
    advanced: {
      // The ids are UUIDs that the database generates, like those of all other tables.
      database: { generateId: false },
      // `Secure` cookies need HTTPS, which the reverse proxy in front of a container provides; browsers also keep them
      // on `localhost`. The development server speaks plain HTTP, also to other machines of the local network.
      useSecureCookies: getServerEnv().NODE_ENV === "production",
    },
    emailAndPassword: {
      enabled: true,
      // Users are created by the users service, never by a sign-up.
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Argon2id with the limit on concurrent hashes, in place of the scrypt of Better Auth.
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      // The session ends 30 days after the login, however much it is used. The cookie cache stays off, so every check
      // of a session reads the database.
      disableSessionRefresh: true,
    },
    user: {
      additionalFields: {
        // Read with the user of a session; `input: false` keeps it out of everything a request can set.
        mustChangePassword: { type: "boolean", required: true, defaultValue: true, input: false },
      },
    },
    telemetry: { enabled: false },
    logger: {
      // Only the errors of Better Auth are logged, through the pino logger. Its warnings are left out: one says at
      // every start that no base URL is set, which is on purpose (Better Auth uses it for its HTTP handler and for
      // links in mails, and HippoWiki has neither), the others repeat a refused login, which the auth service logs
      // itself, with the user name.
      level: "error",
      log: (level, message, ...args) => {
        logger[level]({ betterAuth: args }, message);
      },
    },
    plugins: [
      username({
        minUsernameLength: USER_NAME_MIN_LENGTH,
        maxUsernameLength: USER_NAME_MAX_LENGTH,
        // The name rule of HippoWiki in place of the character check of the plugin.
        usernameValidator: (name) => NAME_PATTERN.test(name),
      }),
      // Must be the last plugin: it copies the cookies that an endpoint set to the response of a Server Action.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

// The instance is created on first use and kept for the process, like the client of `getDb()`: nothing happens on
// import, because `npm run build` runs without a database. On `globalThis`, so that it survives hot reloads.
const globalForAuth = globalThis as typeof globalThis & { hippowikiAuth?: Promise<Auth> };

/** The Better Auth instance of the process. It reads the secret of the session cookies from the database first. */
export function getAuth(): Promise<Auth> {
  globalForAuth.hippowikiAuth ??= readSecret()
    .then(createAuth)
    .catch((err: unknown) => {
      // E.g. the database was not reachable: the next call tries again instead of keeping the failure.
      globalForAuth.hippowikiAuth = undefined;
      throw err;
    });
  return globalForAuth.hippowikiAuth;
}
