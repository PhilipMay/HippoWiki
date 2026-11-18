// The clean-up of OAuth: deletes the rows that nothing needs any more. There is no job scheduler, so it runs when a
// client is registered (`clients-service.ts`) or a code is created (`authorization-service.ts`).

import { currentTime, REGISTRATION_WINDOW_MS } from "@/features/oauth/rows";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

/** How old a client that no grant and no code names has to be before it is deleted. */
const UNUSED_CLIENT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes what nothing needs any more: the codes that have expired, the windows of registrations whose hour is over,
 * and the clients that are more than a day old and that no grant and no code names. A failure is logged and does not
 * fail the write that caused the clean-up.
 */
export async function deleteStaleRows(): Promise<void> {
  const now = currentTime().getTime();
  const db = getDb();
  try {
    await db.oAuthCode.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
  } catch (err) {
    logger.error({ err }, "failed to delete the expired authorization codes");
  }
  try {
    await db.oAuthRegistrationWindow.deleteMany({
      where: { startedAt: { lte: new Date(now - REGISTRATION_WINDOW_MS) } },
    });
  } catch (err) {
    logger.error({ err }, "failed to delete the windows of registrations whose hour is over");
  }
  try {
    await db.oAuthClient.deleteMany({
      where: {
        createdAt: { lt: new Date(now - UNUSED_CLIENT_RETENTION_MS) },
        codes: { none: {} },
        grants: { none: {} },
      },
    });
  } catch (err) {
    logger.error({ err }, "failed to delete the oauth clients that nothing names");
  }
}
