// Helpers shared by the unit tests: the errors that the mocked `redirect()` and `notFound()` of `next/navigation`
// throw, the Prisma errors that a mocked database gives, and the ids and actors of the tests of the content services.
// It is no test itself and is left out of the coverage (`vitest.config.ts`). It imports no service, so that a test can
// import it before its `vi.mock` calls take effect.
import { vi } from "vitest";

import type { BrowserActor, McpActor } from "@/features/folder-roles/service";
import { Prisma } from "@/generated/prisma/client";

/** What the mocked `redirect()` throws, like the real one: code after it never runs, and a test asserts the path. */
export class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`redirect to ${path}`);
  }
}

/** What the mocked `notFound()` throws, like the real one. */
export class NotFoundError extends Error {}

/** A Prisma error as the client reports it, e.g. `P2002` for a unique violation. */
export function knownError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("database error", { code, clientVersion: "test", meta });
}

/** A unique violation as reported with the `pg` adapter, on the given index or fields. */
export function uniqueViolation(constraint: {
  index?: string;
  fields?: string[];
}): Prisma.PrismaClientKnownRequestError {
  return knownError("P2002", { driverAdapterError: { cause: { constraint } } });
}

/** A foreign key violation as reported with the `pg` adapter, on the given constraint or fields. */
export function foreignKeyViolation(constraint: {
  index?: string;
  fields?: string[];
}): Prisma.PrismaClientKnownRequestError {
  return knownError("P2003", { driverAdapterError: { cause: { constraint } } });
}

/**
 * What the first call of the given write stores: the `data` of its argument. The tests of the services assert what a
 * write stores, not the condition it finds its row with, which the integration tests prove against the database.
 */
export function dataOf(write: ReturnType<typeof vi.fn>): unknown {
  return (write.mock.calls[0]?.[0] as { data?: unknown } | undefined)?.data;
}

export const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";
/** A folder that is not the one of the MCP connection of `MCP_ACTOR`. */
export const OTHER_FOLDER_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e55";
export const TAB_ID = "5a2c1c0e-3f55-4a55-8a42-5d2f0e6a9b11";
export const PAGE_ID = "9c4d2b7e-1a3f-4c5d-8e6f-7a8b9c0d1e22";
export const ACTOR_ID = "9d4b2f6e-1c3a-4e8b-b7d5-2a6c8e0f1b12";
export const GRANT_ID = "0d1f3b52-5d1e-4c8a-9a51-6c8e2f9b7a01";
export const MALFORMED_ID = "not-a-uuid";

/** The user who makes the writes, without a channel: the actor of the writes of roles. */
export const USER = { id: ACTOR_ID, name: "alice", type: "user" as const };
/** The user who makes the writes in the browser. */
export const ACTOR: BrowserActor = { ...USER, channel: "browser" };
/** The same user with a malformed id, which only a broken caller passes. */
export const MALFORMED_ACTOR: BrowserActor = { ...ACTOR, id: MALFORMED_ID };
/** An admin in the browser, who sees and changes no content; named like the user, so that only the type decides. */
export const ADMIN: BrowserActor = { ...ACTOR, type: "admin" };

/** The same user through MCP, with a connection of the given role to the folder `FOLDER_ID`. */
export function mcpActor(role: McpActor["connection"]["role"]): McpActor {
  return { ...ACTOR, channel: "mcp", connection: { grantId: GRANT_ID, folderId: FOLDER_ID, role } };
}

/** The same user through MCP, with a Writer connection to the folder `FOLDER_ID`. */
export const MCP_ACTOR: McpActor = mcpActor("writer");
