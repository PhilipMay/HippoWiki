// The roles of users on folders. The service knows nothing about Next.js, forms or addresses, so that the GUI and any
// other caller can use it, also outside a request. It trusts no caller: ids are parsed here again.
//
// A role is read from the database on every call and never cached, also not in the session, so that a change of a
// role takes effect with the next request of the user it concerns.

import { mayDo, rolesFor, type FolderFunction, type Role } from "@/features/folder-roles/roles";
import { parseFolderId, parseTabId } from "@/features/folders/schema";
import { parsePageId } from "@/features/pages/schema";
import { parseUserId } from "@/features/users/schema";
import type { Actor } from "@/features/users/service";
import { isAdmin } from "@/features/users/user-type";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Where a read or a write of the content comes from. In the browser a user sees and does with a folder only what the
 * role on it allows; through MCP a user reads every folder, as before folder roles came, until MCP gets rules of its
 * own. MCP has no writes, so a write is always one of the browser.
 */
export type Channel = "browser" | "mcp";

/** The actor of a read of the content, together with the channel of the call, which no caller can leave out. */
export type ContentActor = Actor & { channel: Channel };

/** The actor of a write of the content: always one of the browser. */
export type BrowserActor = Actor & { channel: "browser" };

/** The actor of the browser for the given user, as the queries and actions pass it to the services. */
export function inBrowser(user: Actor): BrowserActor {
  return { id: user.id, name: user.name, type: user.type, channel: "browser" };
}

/** The actor of MCP for the given user, as the tools of the MCP server pass it to the services. */
export function inMcp(user: Actor): ContentActor {
  return { id: user.id, name: user.name, type: user.type, channel: "mcp" };
}

/**
 * The id of the actor, or `null` for an admin, who never has a role, and for a malformed id, which is logged: the
 * adapters take the actor from a valid session, so only a broken caller passes a malformed id.
 */
function roleHolderId(actor: Actor): string | null {
  if (isAdmin(actor)) return null;
  const id = parseUserId(actor.id);
  if (!id) logger.error({ actorId: actor.id }, "malformed actor id");
  return id;
}

/** The role of the user with the given id on the folder that the condition selects, or `null` without one. */
async function roleWhere(
  userId: string,
  folder: { id: string } | { tabs: { some: { id: string } } } | { pages: { some: { id: string } } },
): Promise<Role | null> {
  const row = await getDb().folderRole.findFirst({ where: { userId, folder }, select: { role: true } });
  return row?.role ?? null;
}

/**
 * The role of the actor on the folder with the given id, or `null` for an admin, a malformed id, a folder that does not
 * exist and a folder without a role of the actor.
 */
export async function folderRoleOf(actor: Actor, folderId: string): Promise<Role | null> {
  const userId = roleHolderId(actor);
  const id = parseFolderId(folderId);
  if (!userId || !id) return null;
  return roleWhere(userId, { id });
}

/**
 * The role of the actor on the folder of the tab with the given id, or `null` for an admin, a malformed id, a tab that
 * does not exist and a folder without a role of the actor. A missing tab and a missing role give the same answer, so
 * that nothing tells whether a tab exists.
 */
export async function roleOnFolderOfTab(actor: Actor, tabId: string): Promise<Role | null> {
  const userId = roleHolderId(actor);
  const id = parseTabId(tabId);
  if (!userId || !id) return null;
  return roleWhere(userId, { tabs: { some: { id } } });
}

/**
 * The role of the actor on the folder of the page with the given id, deleted pages included, or `null` for an admin, a
 * malformed id, a page that does not exist and a folder without a role of the actor. A missing page and a missing role
 * give the same answer, so that nothing tells whether a page exists.
 */
export async function roleOnFolderOfPage(actor: Actor, pageId: string): Promise<Role | null> {
  const userId = roleHolderId(actor);
  const id = parsePageId(pageId);
  if (!userId || !id) return null;
  return roleWhere(userId, { pages: { some: { id } } });
}

/**
 * The user whose roles decide a read: the parsed id of the actor for a read of the browser, `"any"` for a read of MCP,
 * which ignores roles, and `null` for an actor who may read no content: an admin, or a malformed id, which is logged.
 */
export function readerOf(actor: ContentActor): string | "any" | null {
  if (isAdmin(actor)) return null;
  if (actor.channel === "mcp") return "any";
  return roleHolderId(actor);
}

/**
 * The condition on the folder of a read of the given function, by default reading the folder: for a read of the
 * browser a role of the actor on it that allows the function, for a read of MCP none; `null` for an actor who may read
 * no content.
 */
export function readableFolderWhere(actor: ContentActor, fn: FolderFunction = "read"): Prisma.FolderWhereInput | null {
  const reader = readerOf(actor);
  if (!reader) return null;
  if (reader === "any") return {};
  // Every role may read, so reading needs only a role; the other functions need one of the roles that allow them.
  return { roles: { some: { userId: reader, ...(fn === "read" ? {} : { role: { in: rolesFor(fn) } }) } } };
}

const ROLE_SELECT = { role: true } as const;

/** The selection of the reader's role on a folder, as part of the selection of the folder. */
export type RoleSelection = { where?: Prisma.FolderRoleWhereInput; take?: number; select: typeof ROLE_SELECT };

/**
 * The selection of the actor's role on a folder: for a read of the browser the actor's role, for a read of MCP none,
 * so that `roleOf()` gives `null`. Only for an actor who may read, whom `readerOf()` names.
 */
export function roleSelection(reader: string | "any"): RoleSelection {
  if (reader === "any") return { take: 0, select: ROLE_SELECT };
  return { where: { userId: reader }, select: ROLE_SELECT };
}

/** The actor's role from the roles that `roleSelection()` selected of a folder; `null` for a read of MCP. */
export function roleOf(folder: { roles: { role: Role }[] }): Role | null {
  return folder.roles[0]?.role ?? null;
}

/**
 * Whether the actor may read the folder with the given id for the given function, by default reading it: never an
 * admin; in the browser only with a role on the folder that allows the function, so that a folder without one reads
 * like a folder that does not exist; through MCP every folder. A malformed id passes, so that the read itself answers
 * it, without asking the database.
 */
export async function mayReadFolder(
  actor: ContentActor,
  folderId: string,
  fn: FolderFunction = "read",
): Promise<boolean> {
  if (isAdmin(actor)) return false;
  if (actor.channel === "mcp" || !parseFolderId(folderId)) return true;
  return mayDo(await folderRoleOf(actor, folderId), fn);
}

/** Whether the actor may read the tab with the given id: like `mayReadFolder()`, for the folder of the tab. */
export async function mayReadTab(actor: ContentActor, tabId: string): Promise<boolean> {
  if (isAdmin(actor)) return false;
  if (actor.channel === "mcp" || !parseTabId(tabId)) return true;
  return (await roleOnFolderOfTab(actor, tabId)) !== null;
}
