// The clients of OAuth: the registration of a client (dynamic client registration, RFC 7591) with its limit per client
// address group and hour, and the lookup of the client of a request, a registered one or one from its metadata
// document (Client ID Metadata Document), which is fetched and kept. A client is public: it has no secret and proves
// itself with PKCE (`S256`). The service knows nothing about HTTP or Next.js; `http.ts` is its adapter.

import { deleteStaleRows } from "@/features/oauth/cleanup-service";
import { fetchMetadataDocument } from "@/features/oauth/metadata-fetch";
import {
  CLIENT_SELECT,
  currentTime,
  REGISTRATION_WINDOW_MS,
  toClient,
  type ClientRow,
  type OAuthClient,
} from "@/features/oauth/rows";
import {
  clientRegistrationSchema,
  metadataCacheSeconds,
  parseClientRowId,
  parseMetadataDocument,
  parseMetadataUrl,
} from "@/features/oauth/schema";
import { isClientAddressGroup, SHARED_CLIENT_ADDRESS } from "@/lib/client-address";
import { getDb } from "@/lib/db";
import { isUniqueViolation, OAUTH_CLIENT_METADATA_URL } from "@/lib/db-errors";
import { logger } from "@/lib/logger";
import type { Failed, Result } from "@/lib/result";

/** At most this many clients are registered per client address group and hour. */
export const MAX_REGISTRATIONS_PER_WINDOW = 20;

/** How often a registration reads the window again when other registrations of its group got in between. */
const MAX_RESERVE_ROUNDS = 50;

/** The metadata of a registration is not an object, or its redirect addresses are missing or not allowed. */
type InvalidClientMetadata = { code: "invalid-client-metadata" | "invalid-redirect-uri"; description: string };

/** The client address group has registered the most clients allowed in its hour; `waitMs` until the hour is over. */
type TooManyRegistrations = { code: "wait"; waitMs: number };

type RegisterClientError = InvalidClientMetadata | TooManyRegistrations | Failed;

/**
 * Counts a registration of the client address group in its hour, or returns how long the group has to wait when the
 * hour is full. The count is a conditional write that is repeated when another registration of the group got in
 * between, as the logins are counted (`reserveAttempt()` of the auth service), so registrations at the same time
 * cannot pass the limit together. `null` when the registration was counted.
 */
async function reserveRegistration(clientAddress: string): Promise<{ waitMs: number } | null> {
  const db = getDb();
  for (let round = 0; round < MAX_RESERVE_ROUNDS; round += 1) {
    const now = currentTime();
    const window = await db.oAuthRegistrationWindow.findUnique({
      where: { clientAddress },
      select: { registrations: true, startedAt: true },
    });
    const running = window && now.getTime() < window.startedAt.getTime() + REGISTRATION_WINDOW_MS ? window : null;
    if (running && running.registrations >= MAX_REGISTRATIONS_PER_WINDOW) {
      return { waitMs: running.startedAt.getTime() + REGISTRATION_WINDOW_MS - now.getTime() };
    }
    const counted = running
      ? await db.oAuthRegistrationWindow.updateMany({
          where: { clientAddress, startedAt: running.startedAt, registrations: { lt: MAX_REGISTRATIONS_PER_WINDOW } },
          data: { registrations: { increment: 1 } },
        })
      : window
        ? // The hour is over: the window starts again, unless another registration has started it already.
          await db.oAuthRegistrationWindow.updateMany({
            where: { clientAddress, registrations: window.registrations, startedAt: window.startedAt },
            data: { registrations: 1, startedAt: now },
          })
        : // A row that another registration created in the meantime is skipped and reported as a count of 0.
          await db.oAuthRegistrationWindow.createMany({
            data: [{ clientAddress, registrations: 1, startedAt: now }],
            skipDuplicates: true,
          });
    if (counted.count === 1) return null;
  }
  throw new Error("the count of the registrations kept changing, the registration was not counted");
}

/**
 * Registers a client from the metadata it sent (dynamic client registration, RFC 7591). Only the redirect addresses
 * and the name are read; the client is public, whatever it asked for.
 *
 * Anyone can register without a login, so at most 20 clients are registered per client address group and hour
 * (`wait`), and a client that nothing names is deleted after a day. The adapter reads the group from the request and
 * passes it as a plain string; a value that is not a group counts in the shared group. Metadata that is refused is
 * not counted, because it writes nothing.
 */
export async function registerClient(
  metadata: unknown,
  clientAddressGroup: string,
): Promise<Result<OAuthClient, RegisterClientError>> {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return {
      ok: false,
      error: { code: "invalid-client-metadata", description: "The client metadata must be an object" },
    };
  }
  const parsed = clientRegistrationSchema.safeParse(metadata);
  if (!parsed.success) {
    const description = parsed.error.issues[0]?.message ?? "redirect_uris is not valid";
    return { ok: false, error: { code: "invalid-redirect-uri", description } };
  }

  // The service trusts no caller: a group that `client-address.ts` would not write could be any text.
  let clientAddress = clientAddressGroup;
  if (!isClientAddressGroup(clientAddress)) {
    logger.error("registration with an invalid client address group, counted in the shared group");
    clientAddress = SHARED_CLIENT_ADDRESS;
  }

  let client: OAuthClient;
  try {
    const wait = await reserveRegistration(clientAddress);
    if (wait) {
      logger.warn({ clientAddress, waitMs: wait.waitMs }, "oauth client not registered: too many registrations");
      return { ok: false, error: { code: "wait", waitMs: wait.waitMs } };
    }
    const row = await getDb().oAuthClient.create({
      data: { name: parsed.data.client_name, redirectUris: parsed.data.redirect_uris },
      select: CLIENT_SELECT,
    });
    client = toClient(row);
  } catch (err) {
    logger.error({ err, clientAddress }, "failed to register oauth client");
    return { ok: false, error: { code: "failed" } };
  }

  logger.info({ clientRowId: client.id, clientAddress }, "oauth client registered");
  await deleteStaleRows();
  return { ok: true, value: client };
}

/**
 * The client that calls itself `clientId` in a request, or `null` if there is none: a client from a metadata document
 * by the URL of the document, or a registered client by its id. A value that is neither never reaches the database.
 */
export async function findClient(clientId: string): Promise<ClientRow | null> {
  const metadataUrl = parseMetadataUrl(clientId);
  if (metadataUrl) return findMetadataClient(metadataUrl);
  const id = parseClientRowId(clientId);
  if (!id) return null;
  // Only a registered client is known by the id of its row; a client from a metadata document only by its URL.
  return getDb().oAuthClient.findFirst({ where: { id, metadataUrl: null }, select: CLIENT_SELECT });
}

/**
 * The client whose metadata document is at the given URL (Client ID Metadata Document), or `null` if the document
 * cannot be fetched or is not valid; the reason is logged with the URL. The document is kept as a row and fetched
 * again once the row is older than the cache time of its response (`metadataCacheSeconds()`). A fetch that fails
 * refuses the request also when an older row exists: the row and its grants stay as they are.
 */
async function findMetadataClient(metadataUrl: string): Promise<ClientRow | null> {
  const db = getDb();
  const now = currentTime();
  const stored = await db.oAuthClient.findUnique({
    where: { metadataUrl },
    select: { ...CLIENT_SELECT, freshUntil: true },
  });
  if (stored?.freshUntil && stored.freshUntil.getTime() > now.getTime()) return stored;

  const fetched = await fetchMetadataDocument(metadataUrl);
  if (!fetched.ok) {
    logger.warn({ metadataUrl, reason: fetched.reason }, "client metadata document not fetched");
    return null;
  }
  const parsed = parseMetadataDocument(metadataUrl, fetched.document);
  if (!parsed.ok) {
    logger.warn({ metadataUrl, reason: parsed.reason }, "client metadata document refused");
    return null;
  }

  const document = {
    name: parsed.metadata.name,
    redirectUris: parsed.metadata.redirectUris,
    fetchedAt: now,
    freshUntil: new Date(now.getTime() + metadataCacheSeconds(fetched.cacheControl) * 1000),
  };
  try {
    const row = await db.oAuthClient.upsert({
      where: { metadataUrl },
      create: { metadataUrl, ...document },
      update: document,
      select: CLIENT_SELECT,
    });
    logger.info(
      { clientRowId: row.id, metadataUrl },
      stored ? "client metadata document fetched again" : "oauth client created from its metadata document",
    );
    return row;
  } catch (err) {
    // Two requests fetched the document of a new client at the same time; the other one stored it.
    if (isUniqueViolation(err, OAUTH_CLIENT_METADATA_URL)) {
      return db.oAuthClient.findUnique({ where: { metadataUrl }, select: CLIENT_SELECT });
    }
    throw err;
  }
}
