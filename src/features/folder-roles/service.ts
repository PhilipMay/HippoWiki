// The roles of users on folders. The service knows nothing about Next.js, forms or addresses, so that the GUI and any
// other caller can use it, also outside a request. It trusts no caller: ids are parsed here again.
//
// A role is read from the database on every call and never cached, also not in the session, so that a change of a
// role takes effect with the next request of the user it concerns.
//
// Every user with a role on a folder sees who has which role on it; an admin sees the roles of no folder here.

import { includesRole, mayDo, rolesFor, type FolderFunction, type Role } from "@/features/folder-roles/roles";
import { editorIdOf, isMcpActor, lookUp, notAllowed, type ContentActor } from "@/features/folder-roles/actors";
import {
  changeRoleInputSchema,
  giveRoleInputSchema,
  type ChangeRoleFieldErrors,
  type GiveRoleFieldErrors,
} from "@/features/folder-roles/schema";
import { parseFolderId, parseTabId } from "@/features/folders/schema";
import { parsePageId } from "@/features/pages/schema";
import { parseUserId, parseUserName } from "@/features/users/schema";
import type { Actor } from "@/features/users/service";
import { isAdmin } from "@/features/users/user-type";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { FOLDER_ROLE_USER, isAdminRoleViolation, isUniqueViolation } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import { invalidInput, type Failed, type InvalidInput, type NotAllowed, type Result } from "@/lib/result";

/**
 * The role that counts for the actor on the folder with the given id, from the user's role on it: for an actor of the
 * browser and a plain actor that role, for an actor of MCP the lower of it and the role of the connection on the
 * folder of the connection, and no role on every other folder.
 */
function effectiveRole(actor: Actor | ContentActor, folderId: string, role: Role | null): Role | null {
  if (!isMcpActor(actor)) return role;
  const { connection } = actor;
  if (role === null || folderId !== connection.folderId) return null;
  return includesRole(role, connection.role) ? connection.role : role;
}

/**
 * The id of the actor, or `null` for an admin, who never has a role, and for a malformed id, which is logged: the
 * adapters take the actor from a valid session, so only a broken caller passes a malformed id.
 */
function roleHolderId(actor: Actor): string | null {
  if (isAdmin(actor)) return null;
  return editorIdOf(actor);
}

/** The folder a role is read on: by its id, by one of its tabs or by one of its pages. */
type FolderCondition = { id?: string; tabs?: { some: { id: string } }; pages?: { some: { id: string } } };

/**
 * The role that counts for the actor on the folder that the condition selects, or `null` without one: an actor of MCP
 * reads only the folder of its connection, so the condition is narrowed to it.
 */
async function roleWhere(actor: Actor | ContentActor, userId: string, folder: FolderCondition): Promise<Role | null> {
  if (!isMcpActor(actor)) {
    const row = await getDb().folderRole.findFirst({ where: { userId, folder }, select: { role: true } });
    return row?.role ?? null;
  }
  const { folderId } = actor.connection;
  if (folder.id !== undefined && folder.id !== folderId) return null;
  const row = await getDb().folderRole.findFirst({
    where: { userId, folder: { ...folder, id: folderId } },
    select: { role: true },
  });
  return effectiveRole(actor, folderId, row?.role ?? null);
}

/**
 * The role of the actor on the folder with the given id, or `null` for an admin, a malformed id, a folder that does not
 * exist and a folder without a role of the actor. For an actor of MCP it is the lower of the user's role and the role
 * of the connection, and `null` on every folder but the one of the connection; a plain actor, without a channel, gets
 * the user's own role.
 */
export async function folderRoleOf(actor: Actor | ContentActor, folderId: string): Promise<Role | null> {
  const userId = roleHolderId(actor);
  const id = parseFolderId(folderId);
  if (!userId || !id) return null;
  return roleWhere(actor, userId, { id });
}

/**
 * The role of the actor on the folder of the tab with the given id, or `null` for an admin, a malformed id, a tab that
 * does not exist and a folder without a role of the actor; for an actor of MCP as in `folderRoleOf()`. A missing tab
 * and a missing role give the same answer, so that nothing tells whether a tab exists.
 */
export async function roleOnFolderOfTab(actor: Actor | ContentActor, tabId: string): Promise<Role | null> {
  const userId = roleHolderId(actor);
  const id = parseTabId(tabId);
  if (!userId || !id) return null;
  return roleWhere(actor, userId, { tabs: { some: { id } } });
}

/**
 * The role of the actor on the folder of the page with the given id, deleted pages included, or `null` for an admin, a
 * malformed id, a page that does not exist and a folder without a role of the actor; for an actor of MCP as in
 * `folderRoleOf()`. A missing page and a missing role give the same answer, so that nothing tells whether a page
 * exists.
 */
export async function roleOnFolderOfPage(actor: Actor | ContentActor, pageId: string): Promise<Role | null> {
  const userId = roleHolderId(actor);
  const id = parsePageId(pageId);
  if (!userId || !id) return null;
  return roleWhere(actor, userId, { pages: { some: { id } } });
}

/**
 * The user whose roles decide a read: the parsed id of the actor, and `null` for an actor who may read no content: an
 * admin, or a malformed id, which is logged.
 */
export function readerOf(actor: ContentActor): string | null {
  if (isAdmin(actor)) return null;
  return roleHolderId(actor);
}

/** A condition on a folder that no folder meets. */
const NO_FOLDER: Prisma.FolderWhereInput = { id: { in: [] } };

/**
 * The condition on the folder of a read of the given function, by default reading the folder: a role of the actor on
 * it that allows the function; for an actor of MCP also that it is the folder of the connection and that the role of
 * the connection allows the function. `null` for an actor who may read no content.
 */
export function readableFolderWhere(actor: ContentActor, fn: FolderFunction = "read"): Prisma.FolderWhereInput | null {
  const reader = readerOf(actor);
  if (!reader) return null;
  // Every role may read, so reading needs only a role; the other functions need one of the roles that allow them.
  const roles = { roles: { some: { userId: reader, ...(fn === "read" ? {} : { role: { in: rolesFor(fn) } }) } } };
  if (actor.channel === "web") return roles;
  if (!mayDo(actor.connection.role, fn)) return NO_FOLDER;
  return { id: actor.connection.folderId, ...roles };
}

const ROLE_SELECT = { role: true } as const;

/** The selection of the reader's role on a folder, as part of the selection of the folder. */
export type RoleSelection = { where: Prisma.FolderRoleWhereInput; select: typeof ROLE_SELECT };

/** The selection of the reader's role on a folder. Only for an actor who may read, whom `readerOf()` names. */
export function roleSelection(reader: string): RoleSelection {
  return { where: { userId: reader }, select: ROLE_SELECT };
}

/**
 * The role that counts for the actor on a folder, from the roles that `roleSelection()` selected of it: for an actor of
 * MCP the lower of the user's role and the role of the connection.
 */
export function roleOf(folder: { id: string; roles: { role: Role }[] }, actor: ContentActor): Role | null {
  return effectiveRole(actor, folder.id, folder.roles[0]?.role ?? null);
}

/**
 * Whether the actor may read the folder with the given id for the given function, by default reading it: never an
 * admin, and only with a role on the folder that allows the function, so that a folder without one reads like a
 * folder that does not exist; for an actor of MCP the role of `folderRoleOf()`. A malformed id passes, so that the
 * read itself answers it, without asking the database.
 */
export async function mayReadFolder(
  actor: ContentActor,
  folderId: string,
  fn: FolderFunction = "read",
): Promise<boolean> {
  if (isAdmin(actor)) return false;
  if (!parseFolderId(folderId)) return true;
  return mayDo(await folderRoleOf(actor, folderId), fn);
}

/** Whether the actor may read the tab with the given id: like `mayReadFolder()`, for the folder of the tab. */
export async function mayReadTab(actor: ContentActor, tabId: string): Promise<boolean> {
  if (isAdmin(actor)) return false;
  if (!parseTabId(tabId)) return true;
  return (await roleOnFolderOfTab(actor, tabId)) !== null;
}

/** A user with a role on a folder, as the roles view shows it. */
export type FolderRoleEntry = { user: { id: string; name: string }; role: Role };

/**
 * The order of the roles view: Owners first, then Managers, Writers and Readers, each group by user name. The database
 * sorts an enum in the order of its values, from Reader to Owner, so the roles are sorted descending.
 */
const ROLE_LIST_ORDER = [
  { role: "desc" },
  { user: { username: "asc" } },
] satisfies Prisma.FolderRoleOrderByWithRelationInput[];

/**
 * Every user with a role on the folder with the given id and the role, Owners first, then Managers, Writers and
 * Readers, each group by user name. `null` for an admin, a malformed id and a folder without a role of the actor, for
 * whom the folder does not exist.
 */
export async function listFolderRoles(actor: Actor, folderId: string): Promise<FolderRoleEntry[] | null> {
  const folder = parseFolderId(folderId);
  if (!folder || !(await folderRoleOf(actor, folder))) return null;
  const roles = await getDb().folderRole.findMany({
    where: { folderId: folder },
    select: { role: true, user: { select: { id: true, username: true } } },
    orderBy: ROLE_LIST_ORDER,
  });
  return roles.map(({ role, user }) => ({ user: { id: user.id, name: user.username }, role }));
}

/** A user who can get a role on a folder, as the "Give role" dialog offers them. */
export type RoleCandidate = { id: string; name: string };

/**
 * Every account of the type user without a role on the folder with the given id, by name: whom an Owner can give a
 * role. Never an admin, who never gets a role. `null` for anyone but an Owner of the folder.
 */
export async function listRoleCandidates(actor: Actor, folderId: string): Promise<RoleCandidate[] | null> {
  const folder = parseFolderId(folderId);
  if (!folder || !mayDo(await folderRoleOf(actor, folder), "manageRoles")) return null;
  const users = await getDb().user.findMany({
    where: { type: "user", folderRoles: { none: { folderId: folder } } },
    select: { id: true, username: true },
    orderBy: { username: "asc" },
  });
  return users.map(({ id, username }) => ({ id, name: username }));
}

/** The input is invalid; `fieldErrors` holds the messages of the schema per field. */
type InvalidGiveRole = InvalidInput<GiveRoleFieldErrors>;
/** No account of the type user has the name: it does not exist or is an admin, who never gets a role. */
type UserNotFound = { code: "user-not-found" };
/** The user already has a role on the folder. */
type RoleTaken = { code: "role-taken" };

export type GiveRoleError = NotAllowed | InvalidGiveRole | UserNotFound | RoleTaken | Failed;

/** A role as stored by a write, with the name of its folder: what the address after the write is built from. */
export type StoredRole = { folder: { name: string }; user: { id: string; name: string }; role: Role };

const STORED_ROLE_SELECT = {
  role: true,
  folder: { select: { name: true } },
  user: { select: { id: true, username: true } },
} as const;

function storedRole(row: { role: Role; folder: { name: string }; user: { id: string; username: string } }): StoredRole {
  return { folder: { name: row.folder.name }, user: { id: row.user.id, name: row.user.username }, role: row.role };
}

/** An Owner of a folder, as a write of a role starts with: the parsed ids of the actor and of the folder. */
type Owner = { actorId: string; folderId: string };

/**
 * The actor of a write of a role and the folder, if the actor is an Owner of the folder with the given id; otherwise
 * the refusal, which is logged: an admin, who changes no role, a malformed actor id, a malformed folder id and every
 * other role. A database error while the role is read gives `failed`, logged with `failure`.
 */
async function ownerOf(
  actor: Actor,
  folderId: string,
  what: string,
  failure: string,
): Promise<{ owner: Owner; refused?: never } | { refused: { ok: false; error: NotAllowed | Failed } }> {
  if (isAdmin(actor)) return { refused: notAllowed(actor, `${what}: the actor is an admin`) };
  const actorId = editorIdOf(actor);
  if (!actorId) return { refused: { ok: false, error: { code: "failed" } } };
  const notOwner = `${what}: the actor is not an Owner of the folder`;
  const folder = parseFolderId(folderId);
  if (!folder) return { refused: notAllowed(actor, notOwner, { folderId }) };
  const role = await lookUp(() => folderRoleOf(actor, folder), { folderId: folder, actorId }, failure);
  if (!role.ok) return { refused: role };
  if (!mayDo(role.value, "manageRoles")) {
    return { refused: notAllowed(actor, notOwner, { folderId: folder, ...(role.value ? { role: role.value } : {}) }) };
  }
  return { owner: { actorId, folderId: folder } };
}

/**
 * Gives the user with the given name the role on the folder with the given id, Owner included, and returns it as
 * stored. Only an Owner of the folder gives roles. The user must be an account of the type user without a role on the
 * folder: the name of an admin is answered like an unknown name, so that no form, however crafted, gives an admin a
 * role; the trigger of the database is only the second line. Every role given is logged.
 */
export async function giveRole(
  actor: Actor,
  folderId: string,
  input: { user: string; role: string },
): Promise<Result<StoredRole, GiveRoleError>> {
  const opened = await ownerOf(actor, folderId, "role not given", "failed to give role");
  if (opened.refused) return opened.refused;
  const { actorId, folderId: folder } = opened.owner;

  const parsed = giveRoleInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { role } = parsed.data;

  const userName = parseUserName(parsed.data.user);
  const found = await lookUp(
    async () =>
      userName
        ? await getDb().user.findFirst({ where: { username: userName, type: "user" }, select: { id: true } })
        : null,
    { folderId: folder, actorId },
    "failed to give role",
  );
  if (!found.ok) return found;
  const user = found.value;
  if (!user) {
    logger.warn({ folderId: folder, actorId }, "role not given: no user of the type user has the name");
    return { ok: false, error: { code: "user-not-found" } };
  }

  let stored: StoredRole;
  try {
    stored = storedRole(
      await getDb().folderRole.create({
        data: { folderId: folder, userId: user.id, role },
        select: STORED_ROLE_SELECT,
      }),
    );
  } catch (err) {
    if (isUniqueViolation(err, FOLDER_ROLE_USER)) {
      logger.warn(
        { folderId: folder, userId: user.id, actorId },
        "role not given: the user already has a role on the folder",
      );
      return { ok: false, error: { code: "role-taken" } };
    }
    if (isAdminRoleViolation(err)) {
      // The user was looked up as a user just before, and the type of an account never changes.
      logger.error(
        { err, folderId: folder, userId: user.id, actorId },
        "role not given: the database refused a role of an admin",
      );
      return { ok: false, error: { code: "user-not-found" } };
    }
    logger.error({ err, folderId: folder, userId: user.id, actorId }, "failed to give role");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ folderId: folder, userId: user.id, oldRole: null, newRole: role, actorId }, "role given");
  return { ok: true, value: stored };
}

/** The user has no role on the folder (any more), or the id is malformed. */
type RoleNotFound = { code: "role-not-found" };
/** The change would leave the folder without an Owner; it has been logged. */
type LastOwner = { code: "last-owner" };
/** The new role is no role; `fieldErrors` holds the message of the schema for the role. */
type InvalidRole = InvalidInput<ChangeRoleFieldErrors>;

export type RemoveRoleError = NotAllowed | RoleNotFound | LastOwner | Failed;
export type ChangeRoleError = RemoveRoleError | InvalidRole;

/**
 * What a change or removal of a role leads to: the name of the folder, for its address, and the role the actor has on
 * it afterwards, which is `null` when Owners removed their own role.
 */
export type RoleChange = { folder: { name: string }; actorRole: Role | null };

/**
 * The outcome of the transaction of a change or removal, before it is logged and returned. `actorRole` is the role of
 * the actor on the folder afterwards.
 */
type ChangeOutcome =
  | { kind: "not-allowed"; actorRole: Role | null }
  | { kind: "role-not-found" }
  | { kind: "last-owner"; oldRole: Role }
  | { kind: "unchanged"; role: Role; folderName: string; actorRole: Role | null }
  | { kind: "stored"; oldRole: Role; folderName: string; actorRole: Role | null };

/**
 * Changes the role of the user on the folder to the given role or, with `null`, removes it, as an Owner. The write
 * starts with the check that the actor is an Owner (`ownerOf()`); the check that the actor is still an Owner and the
 * check of the last Owner then read the roles of the folder again, in the same transaction as the write, with the rows
 * locked, so that two Owners who lower each other at the same time cannot leave the folder without one. A change to
 * the role the user has passes the same checks and then writes nothing, so the role keeps its time; it is answered
 * like a stored change and logged apart from one.
 */
async function writeRole(
  owner: Owner,
  actor: Actor,
  userId: string,
  newRole: Role | null,
  what: string,
): Promise<Result<RoleChange, RemoveRoleError>> {
  const { actorId, folderId: folder } = owner;
  const target = parseUserId(userId);

  let outcome: ChangeOutcome;
  try {
    outcome = await getDb().$transaction(async (tx) => {
      // Locks every role of the folder until the end of the transaction: a second change waits here and then reads
      // the roles as this one left them.
      const roles = await tx.$queryRaw<{ userId: string; role: Role }[]>`
        SELECT "userId", "role" FROM "FolderRole" WHERE "folderId" = ${folder}::uuid FOR UPDATE`;
      const actorRole = roles.find((row) => row.userId === actorId)?.role ?? null;
      if (!mayDo(actorRole, "manageRoles")) return { kind: "not-allowed", actorRole };
      const current = target ? roles.find((row) => row.userId === target) : undefined;
      if (!target || !current) return { kind: "role-not-found" };
      const owners = roles.filter((row) => row.role === "owner").length;
      if (current.role === "owner" && newRole !== "owner" && owners <= 1) {
        return { kind: "last-owner", oldRole: current.role };
      }
      const where = { folderId_userId: { folderId: folder, userId: target } };
      // The roles are locked, so the role read is still the stored one: the same role needs no write.
      const unchanged = newRole === current.role;
      if (newRole === null) await tx.folderRole.delete({ where });
      else if (!unchanged) await tx.folderRole.update({ where, data: { role: newRole } });
      const { name } = await tx.folder.findUniqueOrThrow({ where: { id: folder }, select: { name: true } });
      const actorRoleAfter = target === actorId ? newRole : actorRole;
      if (unchanged) return { kind: "unchanged", role: current.role, folderName: name, actorRole: actorRoleAfter };
      return { kind: "stored", oldRole: current.role, folderName: name, actorRole: actorRoleAfter };
    });
  } catch (err) {
    logger.error({ err, folderId: folder, userId: target, actorId }, "failed to change role");
    return { ok: false, error: { code: "failed" } };
  }

  switch (outcome.kind) {
    case "not-allowed":
      return notAllowed(actor, `${what}: the actor is not an Owner of the folder`, {
        folderId: folder,
        ...(outcome.actorRole ? { role: outcome.actorRole } : {}),
      });
    case "role-not-found":
      logger.warn({ folderId: folder, userId, actorId }, `${what}: the user has no role on the folder`);
      return { ok: false, error: { code: "role-not-found" } };
    case "last-owner":
      logger.warn(
        { folderId: folder, userId: target, oldRole: outcome.oldRole, newRole, actorId },
        `${what}: the folder would be left without an Owner`,
      );
      return { ok: false, error: { code: "last-owner" } };
    case "unchanged":
      logger.info(
        { folderId: folder, userId: target, role: outcome.role, actorId },
        "role unchanged: the role is the same",
      );
      return { ok: true, value: { folder: { name: outcome.folderName }, actorRole: outcome.actorRole } };
    case "stored":
      logger.info(
        { folderId: folder, userId: target, oldRole: outcome.oldRole, newRole, actorId },
        newRole === null ? "role removed" : "role changed",
      );
      return { ok: true, value: { folder: { name: outcome.folderName }, actorRole: outcome.actorRole } };
  }
}

/**
 * Changes the role of the user with the given id on the folder with the given id, as an Owner of the folder; the own
 * role and those of other Owners included. Refused with `last-owner` when it would leave the folder without an Owner.
 * Every change, and every refused change of the last Owner, is logged; a change to the role the user has writes
 * nothing and is logged apart.
 */
export async function changeRole(
  actor: Actor,
  folderId: string,
  userId: string,
  role: string,
): Promise<Result<RoleChange, ChangeRoleError>> {
  const what = "role not changed";
  // The Owner is checked before the role, so that the answer to anyone else does not depend on the input.
  const opened = await ownerOf(actor, folderId, what, "failed to change role");
  if (opened.refused) return opened.refused;
  const parsed = changeRoleInputSchema.safeParse({ role });
  if (!parsed.success) return invalidInput(parsed.error);
  return writeRole(opened.owner, actor, userId, parsed.data.role, what);
}

/**
 * Removes the role of the user with the given id on the folder with the given id, as an Owner of the folder; the own
 * role and those of other Owners included. Refused with `last-owner` when it would leave the folder without an Owner.
 * Every removal, and every refused removal of the last Owner, is logged.
 */
export async function removeRole(
  actor: Actor,
  folderId: string,
  userId: string,
): Promise<Result<RoleChange, RemoveRoleError>> {
  const what = "role not removed";
  const opened = await ownerOf(actor, folderId, what, "failed to change role");
  if (opened.refused) return opened.refused;
  return writeRole(opened.owner, actor, userId, null, what);
}

/** A folder as the overview of the roles shows it to an admin: its name and who has which role on it. */
export type FolderRolesOverview = { id: string; name: string; roles: FolderRoleEntry[] };

/**
 * Every folder by name, each with every user who has a role on it and the role, in the order of the roles view; also a
 * folder on which nobody has a role. Only for an admin, who manages the accounts and so sees who has access to what,
 * but nothing else of the content: no tab, page, time of the last change or last editor. `null` for a user, who sees
 * the roles only of the folders with a role of their own.
 */
export async function listAllFolderRoles(actor: Actor): Promise<FolderRolesOverview[] | null> {
  if (!isAdmin(actor)) return null;
  const folders = await getDb().folder.findMany({
    select: {
      id: true,
      name: true,
      roles: { select: { role: true, user: { select: { id: true, username: true } } }, orderBy: ROLE_LIST_ORDER },
    },
    orderBy: { name: "asc" },
  });
  return folders.map(({ id, name, roles }) => ({
    id,
    name,
    roles: roles.map(({ role, user }) => ({ user: { id: user.id, name: user.username }, role })),
  }));
}
