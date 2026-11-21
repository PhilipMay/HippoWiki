// Keeps the hot module replacement of the development server from reloading the pages under test. Now and then the
// compile pass that a page render schedules lands just after the page has subscribed to its chunk lists. The server
// then answers the subscription of the shared entry chunk list with an update of the type `restart`, or the version of
// the page no longer matches and it sends `reloadPage` ("HMR hash mismatch"); Next.js itself calls the baseline capture
// and subscription setup "not atomic" in `next/dist/server/dev/hot-reloader-turbopack.js` of the installed version.
// The page reloads, its next render schedules the next pass, and the loop never ends: in one run a page loaded itself
// 330 times in 29 seconds, until the test timed out. The tests change no source file, so these two messages never
// carry a real update and are dropped; every other message passes, because a page of Next.js 16 does not hydrate
// without the connection of the hot module replacement, so stubbing the websocket instead would keep it from
// hydrating. A production build has no `/_next/hmr`, so the route never matches there.
import type { Page } from "@playwright/test";

/** The websocket of the hot module replacement of `next dev`, such as `ws://localhost:3101/_next/hmr?id=…`. */
const HMR_SOCKET = /\/_next\/hmr(?:\?|$)/;

/** The message with which the server tells a page to reload. */
const RELOAD_PAGE = "reloadPage";
/** The message that carries the updates of Turbopack; an update of the type `restart` makes the page reload. */
const TURBOPACK_MESSAGE = "turbopack-message";
const RESTART = "restart";

/** The fields of a message of the server that the filter reads; all others are kept as they are. */
type HmrMessage = { type?: unknown; data?: unknown };

/** The JSON object of a text message, or `undefined` for one that is no JSON object. */
function parsed(message: string): HmrMessage | undefined {
  try {
    const value: unknown = JSON.parse(message);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as HmrMessage) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether an update of a `turbopack-message` is one of the type `restart`. */
function isRestart(update: unknown): boolean {
  return typeof update === "object" && update !== null && (update as { type?: unknown }).type === RESTART;
}

/**
 * A message of the server without what asks the page to reload: `null` for `reloadPage` and for a `turbopack-message`
 * of which only updates of the type `restart` are left out, that message without its `restart` updates when it has
 * others, and every other message unchanged, a binary one or a text that is no JSON included.
 */
export function withoutReloads(message: string | Buffer): string | Buffer | null {
  if (typeof message !== "string") return message;
  const json = parsed(message);
  if (json?.type === RELOAD_PAGE) return null;
  if (json?.type !== TURBOPACK_MESSAGE || !Array.isArray(json.data) || !json.data.some(isRestart)) return message;
  const updates = json.data.filter((update) => !isRestart(update));
  return updates.length === 0 ? null : JSON.stringify({ ...json, data: updates });
}

/**
 * Routes the websocket of the hot module replacement of the page through `withoutReloads()`: the page and the server
 * stay connected, the messages of the page reach the server unchanged, and those of the server reach the page without
 * what asks it to reload. The returned promise is settled once the route is in place.
 */
export function keepFromReloading(page: Page): Promise<void> {
  return page.routeWebSocket(HMR_SOCKET, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const kept = withoutReloads(message);
      if (kept !== null) socket.send(kept);
    });
  });
}
