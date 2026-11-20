// The address of a link in the editor as the page view reads it from the Markdown (R17): markdown-it decodes the
// backslash escapes and the entities of a link destination before it checks and links the address, so the editor
// does the same before it decides whether a link shows formatted and before Ctrl+click opens it. The decoding follows
// `unescapeAll` of markdown-it, with the same strict decoding of named entities of `entities`, without bringing
// markdown-it into the chunk of the editor.

import { decodeHTMLStrict } from "entities/decode";

/** A backslash escape of an ASCII punctuation character, or an entity such as `&amp;`, `&#106;` or `&#x6A;`. */
const ESCAPE_OR_ENTITY = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])|&([a-z#][a-z0-9]{1,31});/gi;

const NUMERIC_ENTITY = /^#(?:x[a-f0-9]{1,8}|[0-9]{1,8})$/i;

/** Whether a numeric entity may decode to the code point, as markdown-it decides it; otherwise it stays its text. */
function isValidCodePoint(code: number): boolean {
  if (code >= 0xd800 && code <= 0xdfff) return false;
  if (code >= 0xfdd0 && code <= 0xfdef) return false;
  if ((code & 0xffff) === 0xffff || (code & 0xffff) === 0xfffe) return false;
  if (code <= 0x08 || code === 0x0b || (code >= 0x0e && code <= 0x1f)) return false;
  if (code >= 0x7f && code <= 0x9f) return false;
  return code <= 0x10ffff;
}

function decodeEntity(match: string, name: string): string {
  if (NUMERIC_ENTITY.test(name)) {
    const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return isValidCodePoint(code) ? String.fromCodePoint(code) : match;
  }
  return decodeHTMLStrict(match);
}

/**
 * The address of a link destination or of the definition of a reference link, as its Markdown text gives it: without
 * the angle brackets of `<…>`, with its backslash escapes and entities decoded. Autolinks and bare addresses take
 * their text as it is, as in the page view.
 */
export function linkDestination(text: string): string {
  const inner = text.startsWith("<") && text.endsWith(">") ? text.slice(1, -1) : text;
  if (!inner.includes("\\") && !inner.includes("&")) return inner;
  return inner.replace(
    ESCAPE_OR_ENTITY,
    (match, escaped: string | undefined, entity: string | undefined) => escaped ?? decodeEntity(match, entity ?? ""),
  );
}
