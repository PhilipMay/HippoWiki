// Who reads and writes the content, and how a write of the content opens: the actors with their channel, and the
// guards that the services of folders, pages and folder roles share. No database, so that every adapter can build an
// actor without loading a service.

import { mayDo, type FolderFunction, type McpConnection, type Role } from "@/features/folder-roles/roles";
import { parseUserId } from "@/features/users/schema";
import type { Actor } from "@/features/users/service";
import { isAdmin } from "@/features/users/user-type";
import type { ChangeChannel } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";

/**
 * Where a read or a write of the content comes from: `web` for the browser, `mcp` for MCP. The content stores the same
 * value with its last editor, and every log line names it. In the browser a user sees and does with a folder what the
 * role on it allows. Through MCP a user works only on the folder of the connection, with the lower of the user's
 * current role on it and the role of the connection, and has no role on any other folder.
 */
export type Channel = "web" | "mcp";

/** The actor of the browser: the user of the session. */
export type BrowserActor = Actor & { channel: "web" };

/** The actor of MCP: the user of the access token, together with the connection of its grant. */
export type McpActor = Actor & { channel: "mcp"; connection: McpConnection };

/** The actor of a read or a write of the content, together with the channel of the call, which no caller can leave out. */
export type ContentActor = BrowserActor | McpActor;

/** The actor of the browser for the given user, as the queries and actions pass it to the services. */
export function inBrowser(user: Actor): BrowserActor {
  return { id: user.id, name: user.name, type: user.type, channel: "web" };
}

/** The actor of MCP for the given user and connection, as the adapter of the MCP server passes it to the tools. */
export function inMcp(user: Actor, connection: McpConnection): McpActor {
  return {
    id: user.id,
    name: user.name,
    type: user.type,
    channel: "mcp",
    connection: { grantId: connection.grantId, folderId: connection.folderId, role: connection.role },
  };
}

/** Whether the actor is one of MCP, with a connection. A plain actor, without a channel, is none. */
export function isMcpActor(actor: Actor | ContentActor): actor is McpActor {
  return "channel" in actor && actor.channel === "mcp";
}

/**
 * Where a write comes from, for its log line: the channel and, for MCP, the grant of the connection. The content stores
 * only the channel, never the grant.
 */
export function channelOf(actor: ContentActor): { channel: "web" } | { channel: "mcp"; grantId: string } {
  return actor.channel === "mcp" ? { channel: "mcp", grantId: actor.connection.grantId } : { channel: "web" };
}

/** The actor is an admin, who changes no content, or has no role on the folder that allows the write; it is logged. */
type NotAllowed = { code: "not-allowed" };
/** An unexpected database error, or an actor that is malformed or does not exist; it has been logged. */
type Failed = { code: "failed" };

/**
 * The result of a write by an admin, who changes no content, or by a user whose role does not allow it; it is logged
 * with the id of the actor and the given ids of the target, with the role if there is one.
 */
export function notAllowed(
  actor: Actor,
  message: string,
  target: Record<string, string> = {},
): { ok: false; error: NotAllowed } {
  logger.warn({ actorId: actor.id, ...target }, message);
  return { ok: false, error: { code: "not-allowed" } };
}

/**
 * The result of a write whose function the role of the actor does not include, or `null` if it does. Without a role
 * the folder does not exist for the actor; with a lower role the function is not offered.
 */
export function refusedByRole(
  actor: Actor,
  what: string,
  role: Role | null,
  fn: FolderFunction,
  target: Record<string, string>,
): { ok: false; error: NotAllowed } | null {
  if (mayDo(role, fn)) return null;
  if (role === null) return notAllowed(actor, `${what}: the actor has no role on the folder`, target);
  return notAllowed(actor, `${what}: the role of the actor does not allow it`, { ...target, role });
}

/**
 * The id of the actor, to be stored as the last editor or to read its roles by, or `null` if it is malformed, which is
 * logged: the adapters take the actor from a valid session, so only a broken caller passes a malformed id.
 */
export function editorIdOf(actor: Actor): string | null {
  const id = parseUserId(actor.id);
  if (!id) logger.error({ actorId: actor.id }, "malformed actor id");
  return id;
}

/**
 * The result of a write whose actor does not exist; it is logged, because only a broken caller can cause it. A write
 * tests for it before the other foreign keys, so that a missing actor is never reported as a missing folder or tab.
 */
export function unknownActor(err: unknown, actor: Actor): { ok: false; error: Failed } {
  logger.error({ err, actorId: actor.id }, "actor of write not found");
  return { ok: false, error: { code: "failed" } };
}

/** What a write of the content stores as its last editor: the id of the actor and the channel of the write. */
export type Editor = { lastEditedById: string; lastEditedVia: ChangeChannel };

/**
 * The opening of every write of the content: the last editor the write stores, or the refusal. An admin, who changes no
 * content, gets `not-allowed`, logged as `<what>: the actor is an admin`; a malformed actor id gets `failed`, logged by
 * `editorIdOf()`. Both come before anything else is checked and without asking the database.
 */
export function openContentWrite(
  actor: ContentActor,
  what: string,
): { editor: Editor; refused?: never } | { refused: { ok: false; error: NotAllowed | Failed } } {
  if (isAdmin(actor)) return { refused: notAllowed(actor, `${what}: the actor is an admin`) };
  const lastEditedById = editorIdOf(actor);
  if (!lastEditedById) return { refused: { ok: false, error: { code: "failed" } } };
  return { editor: { lastEditedById, lastEditedVia: actor.channel } };
}
