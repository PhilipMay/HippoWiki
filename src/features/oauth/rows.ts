// What the service modules of OAuth share about their rows: a client as it is read and as the consent page shows it,
// the window of the registrations, the grants that a new grant replaces, and the clock. A pure module: no database,
// so that each service module reads and writes its own rows.

import type { McpAddress } from "@/features/oauth/schema";
import type { Prisma } from "@/generated/prisma/client";

/** A client as the consent page and the registration answer show it. */
export type OAuthClient = {
  /** The id of the row. */
  id: string;
  /** What the client calls itself in a request: the id of a registered client, or the URL of its metadata document. */
  clientId: string;
  name: string;
  redirectUris: string[];
  createdAt: Date;
};

/** The columns of a client that the service modules read. */
export const CLIENT_SELECT = { id: true, metadataUrl: true, name: true, redirectUris: true, createdAt: true } as const;

/** A client as the service modules read it. */
export type ClientRow = {
  id: string;
  metadataUrl: string | null;
  name: string;
  redirectUris: string[];
  createdAt: Date;
};

export function toClient({ id, metadataUrl, name, redirectUris, createdAt }: ClientRow): OAuthClient {
  return { id, clientId: metadataUrl ?? id, name, redirectUris, createdAt };
}

/**
 * How long the window of a client address group lasts, from the first registration counted in it. The registration
 * counts in it, and the clean-up deletes the windows whose hour is over.
 */
export const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;

/**
 * Which of the user's grants a new grant to the client at the given MCP address replaces: the grants at the same
 * address to the same client row and, for a registered client, to registered clients with the same name and the same
 * redirect addresses. A connector that registers itself again on every connect would otherwise leave a grant behind
 * each time. The grants of the client at other addresses stay. The consent page counts with it, and the exchange of a
 * code deletes with it.
 */
export function replacedGrants(userId: string, client: ClientRow, address: McpAddress): Prisma.OAuthGrantWhereInput {
  const sameClient: Prisma.OAuthGrantWhereInput[] = [{ clientId: client.id }];
  if (client.metadataUrl === null) {
    sameClient.push({
      client: { metadataUrl: null, name: client.name, redirectUris: { equals: client.redirectUris } },
    });
  }
  return { userId, folderId: address.folderId, role: address.role, OR: sameClient };
}

/** The current time. The one place the service modules take it from, so that tests can set the clock. */
export function currentTime(): Date {
  return new Date();
}
