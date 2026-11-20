// Helpers shared by the integration tests of the content services: the results they compare with, an actor that does
// not exist, the user "bob", an actor of MCP, and the reads of a stored page and its revisions. The rows themselves are
// created with the helpers of e2e/support/database.ts. It is no test itself.
import { inMcp, type McpActor } from "@/features/folder-roles/actors";
import type { Page, User } from "@/generated/prisma/client";

import { createUser, getTestDb, type FolderRoleData } from "../e2e/support/database";

export const NOT_ALLOWED = { ok: false, error: { code: "not-allowed" } };
export const FAILED = { ok: false, error: { code: "failed" } };

/** An actor that does not exist: a well-formed id that no user has. */
export const UNKNOWN_ACTOR = {
  id: "8f7e6d5c-4b3a-4291-8f7e-6d5c4b3a2910",
  name: "ghost",
  type: "user" as const,
  channel: "web" as const,
};

/** Owner roles for the given users, for `createFolder({ roles })`. */
export function owners(...users: { id: string }[]): FolderRoleData[] {
  return users.map((owner) => ({ user: owner, role: "owner" }));
}

/** Creates the user "bob", the second user of most tests next to the known user "alice". */
export function createBob(): Promise<User> {
  return createUser({ name: "bob" });
}

/** The given user as the actor of MCP, with a connection of the given role to the given folder and a new grant. */
export function mcpActorOf(user: User, folder: { id: string }, role: McpActor["connection"]["role"]): McpActor {
  return inMcp(user, { grantId: crypto.randomUUID(), folderId: folder.id, role });
}

/** The page with the given id as stored, with every column. */
export function storedPage(id: string): Promise<Page> {
  return getTestDb().page.findUniqueOrThrow({ where: { id } });
}

/** The revisions of the page with the given id, oldest first, with what a test compares. */
export function revisionsOf(pageId: string) {
  return getTestDb().pageRevision.findMany({
    where: { pageId },
    orderBy: { number: "asc" },
    select: { number: true, title: true, content: true, userId: true, via: true, revertedTo: true, linksUpdated: true },
  });
}
