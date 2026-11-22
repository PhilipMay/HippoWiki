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

/** The bounds and the default of an environment variable that holds a whole number. */
type WholeNumberBounds = { readonly min: number; readonly max: number; readonly default: number };

/**
 * The body limit of an MCP request in bytes (`HIPPOWIKI_MCP_BODY_LIMIT`). 1 MiB by default, which holds the largest
 * write of a page even when a client escapes every character as `\uXXXX`; it can only be raised, because below it such
 * a write would fail, and at most to 16 MiB, so that one request stays small against the memory of the server.
 */
export const MCP_BODY_LIMIT: WholeNumberBounds = { min: 1_048_576, max: 16_777_216, default: 1_048_576 };
/** How many MCP requests a user may send at once (`HIPPOWIKI_MCP_RATE_BURST`). */
export const MCP_RATE_BURST: WholeNumberBounds = { min: 1, max: 10_000, default: 60 };
/** How many MCP requests the budget of a user gains per minute (`HIPPOWIKI_MCP_RATE_PER_MINUTE`). */
export const MCP_RATE_PER_MINUTE: WholeNumberBounds = { min: 1, max: 100_000, default: 300 };

/**
 * The size limit of an uploaded file in bytes (`HIPPOWIKI_FILE_SIZE_LIMIT`): 25 MiB by default, which holds most
 * manuals and photos, from 1 MiB, so that an ordinary screenshot always fits, to 1 GiB, so that one upload stays small
 * against the disk of the server.
 */
export const FILE_SIZE_LIMIT: WholeNumberBounds = { min: 1_048_576, max: 1_073_741_824, default: 26_214_400 };

/**
 * An optional variable with a whole number within the bounds, its default when it is not set. Only plain decimal
 * digits are accepted: a sign, a fraction, an exponent, spaces, a unit such as `1MiB`, leading zeros or an empty value
 * stop the server, so that a typo does not change a limit.
 */
function wholeNumber({ min, max, default: fallback }: WholeNumberBounds) {
  return z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/, { error: "must be a whole number in plain digits" })
    .transform(Number)
    .pipe(
      z
        .number()
        .min(min, { error: `must be at least ${min}` })
        .max(max, { error: `must be at most ${max}` }),
    )
    .default(fallback);
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
  // The limits of the MCP addresses (see `MCP_BODY_LIMIT` and the two after it). The body limit bounds what one request
  // can make the server read and parse; the rate limit, a budget per user of a burst refilled per minute, bounds how
  // many requests one token can send. Neither can be switched off, and `0` is refused: a reverse proxy may limit more
  // strictly in front of the wiki, but the wiki keeps its own ceiling.
  HIPPOWIKI_MCP_BODY_LIMIT: wholeNumber(MCP_BODY_LIMIT),
  HIPPOWIKI_MCP_RATE_BURST: wholeNumber(MCP_RATE_BURST),
  HIPPOWIKI_MCP_RATE_PER_MINUTE: wholeNumber(MCP_RATE_PER_MINUTE),
  // The directory that keeps the contents of uploaded files, a path relative to the working directory of the server or
  // an absolute one. Without it, or with a directory that is missing or that the server cannot write, files are off:
  // the wiki works, uploads are refused, and the server logs a warning at its start (`src/features/files/store.ts`).
  // An empty value stops the server, so that a typo does not switch files off.
  HIPPOWIKI_FILES_DIR: z.string().min(1, { error: "must be a path" }).optional(),
  // The size limit of an uploaded file (see `FILE_SIZE_LIMIT`).
  HIPPOWIKI_FILE_SIZE_LIMIT: wholeNumber(FILE_SIZE_LIMIT),
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
