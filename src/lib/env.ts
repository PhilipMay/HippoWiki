import { z } from "zod";

/** The hosts for which `HIPPOWIKI_PUBLIC_URL` may use `http`: the own machine, for development and the tests. */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * The origin of a public address of the wiki, or `null` if the value is not one: an `https` URL, or `http` only for
 * the own machine, without user name, password, path, query or fragment. A trailing slash is the only path allowed.
 */
export function parsePublicUrl(value: string): string | null {
  // `new URL()` would trim the value and drop an empty query or fragment, so they are refused here.
  if (value !== value.trim() || value.includes("?") || value.includes("#")) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const allowedProtocol =
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname));
  if (!allowedProtocol || url.username !== "" || url.password !== "" || url.pathname !== "/") return null;
  return url.origin;
}

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
  // The public address of the wiki, as the browsers and the connectors of AI assistants reach it, e.g.
  // `https://wiki.example.com`. It is the issuer of the OAuth authorization server and the base of the addresses that
  // the MCP server gives out; without it there is no OAuth. Kept as the origin, without a trailing slash. Any value
  // that is not such an address stops the server, so that a typo does not publish a wrong issuer.
  HIPPOWIKI_PUBLIC_URL: z
    .string()
    .optional()
    .refine((value) => value === undefined || parsePublicUrl(value) !== null, {
      error: "must be an https:// URL (http:// only for localhost) without user, path, query or fragment",
    })
    .transform((value) => (value === undefined ? undefined : (parsePublicUrl(value) ?? undefined))),
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
