import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

/** Reports whether the application can reach its database. */
export async function GET() {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch (err) {
    logger.error({ err }, "health check failed: database not reachable");
    return Response.json({ status: "error" }, { status: 503 });
  }
}
