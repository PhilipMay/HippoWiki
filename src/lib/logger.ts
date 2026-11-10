import pino, { type Logger } from "pino";
import pretty from "pino-pretty";

import { serverEnvSchema, type ServerEnv } from "@/lib/env";

/**
 * Creates the server logger: human-readable output in development, JSON lines otherwise. In development pino-pretty
 * runs as a synchronous stream in the same thread instead of as a worker transport, which does not resolve reliably
 * inside the Next.js server bundle.
 */
export function createLogger(nodeEnv: ServerEnv["NODE_ENV"]): Logger {
  if (nodeEnv === "development") {
    return pino({ level: "debug" }, pretty({ colorize: true, ignore: "pid,hostname" }));
  }
  return pino({ level: "info" });
}

/**
 * The server logger. Use it instead of `console`. It validates only `NODE_ENV`, so it also works when other variables
 * are missing and their error has to be logged.
 */
export const logger = createLogger(serverEnvSchema.shape.NODE_ENV.parse(process.env.NODE_ENV));
