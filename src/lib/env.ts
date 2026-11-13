import { z } from "zod";

/** Environment variables the server needs. */
export const serverEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgresql:// URL" }),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Logs the forwarding headers of every request, to check the setup of a reverse proxy (`client-address-probe.ts`).
  // Only `true` and `false` are accepted, so that a typo such as `1` or `yes` stops the server instead of doing nothing.
  HIPPOWIKI_LOG_CLIENT_ADDRESS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // How many reverse proxies are in front of the server; the client address of a login is the entry of
  // `X-Forwarded-For` that the last of them added (`client-address.ts`). `0` reads no header. Only one digit is
  // accepted, so that a typo stops the server instead of trusting the wrong entry.
  HIPPOWIKI_TRUSTED_PROXIES: z
    .enum(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"])
    .default("0")
    .transform((value) => Number(value)),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Validates the given environment and throws a readable error if it is invalid. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid server environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/**
 * The validated server environment from `process.env`. Validation runs on first use, so importing this module never
 * fails by itself.
 */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
