// The safe addresses of links and images, in a module without imports, so that the editor uses the one list of safe
// addresses of the page view without bringing markdown-it into its chunk (see "UI" in `architecture.md`).

/**
 * The protocols a link or image may use (a security rule of `pages.md`, "Rendering"); any other address with a protocol,
 * `javascript:`, `vbscript:` and `data:` included, is not parsed as a link or image and stays its Markdown text.
 */
const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(["http", "https", "mailto", "irc", "ircs", "xmpp"]);

/**
 * Returns whether an address may become a link or an image: a relative address, or one with a protocol of
 * `SAFE_PROTOCOLS` in any spelling. A colon counts as the end of a protocol only before the first `/`, `?` or `#`,
 * as browsers read it. markdown-it passes the address after decoding entities and escapes and percent-encoding what
 * is not allowed in a URL, so `&#106;avascript:` arrives as `javascript:`, and a space or control character inside a
 * protocol makes it no protocol of the list.
 */
export function isSafeAddress(address: string): boolean {
  const colon = address.indexOf(":");
  if (colon === -1) return true;
  const pathStart = address.search(/[/?#]/);
  if (pathStart !== -1 && pathStart < colon) return true;
  return SAFE_PROTOCOLS.has(address.slice(0, colon).toLowerCase());
}
