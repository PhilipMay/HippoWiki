import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { editorExtensions } from "@/features/pages/editor/extensions";
import { linkAddressAt } from "@/features/pages/editor/preview-plugin";
import { isSafeAddress } from "@/features/pages/safe-address";

const OPTIONS = {
  newPage: false,
  labelId: "label",
  descriptionId: "description",
  pageList: { pages: [], files: [], places: [] },
};

/** The address that Ctrl+click opens on the first place of `text` in `doc`, as live preview reads it. */
function addressAt(doc: string, text: string): string | null {
  const state = EditorState.create({ doc, extensions: editorExtensions(OPTIONS) });
  ensureSyntaxTree(state, doc.length);
  const pos = doc.indexOf(text);
  if (pos < 0) throw new Error(`"${text}" is not in the document`);
  return linkAddressAt(state, pos);
}

describe("linkAddressAt", () => {
  it("gives the address of an inline link as written, also a relative one", () => {
    expect(addressAt("See [the guide](guides/setup.md) here.", "the guide")).toBe("guides/setup.md");
    expect(addressAt("See [the site](https://example.com/a?b=1) here.", "the site")).toBe("https://example.com/a?b=1");
    expect(addressAt("See [x](<with space.md>).", "x")).toBe("with space.md");
  });

  it("gives the address of the definition of a full and a shortcut reference link, by its label", () => {
    const doc = "A [full][Site] and a [SITE].\n\n[site]: https://example.com/ref\n";

    expect(addressAt(doc, "full")).toBe("https://example.com/ref");
    expect(addressAt(doc, "SITE]")).toBe("https://example.com/ref");
    expect(addressAt("A [missing][nowhere].\n", "missing")).toBeNull();
  });

  it("decodes the escapes and entities of a link destination as the page view does", () => {
    expect(addressAt("[x](a\\_b&amp;c&#x41;)", "x")).toBe("a_b&cA");
    expect(addressAt("[x][r]\n\n[r]: /a&#38;b\\*\n", "x")).toBe("/a&b*");
  });

  it("gives an autolink and a bare address their address, and nothing for text and an image", () => {
    expect(addressAt("Mail <https://example.com/auto> now.", "example")).toBe("https://example.com/auto");
    expect(addressAt("Go to www.example.com now.", "example")).toBe("http://www.example.com");
    expect(addressAt("Plain text.", "text")).toBeNull();
    expect(addressAt("![a picture](picture.png)", "picture")).toBeNull();
  });

  // The address is checked as decoded, so an entity cannot hide an unsafe protocol from the check of the click.
  it("gives an unsafe address decoded, which the check of the click refuses", () => {
    const address = addressAt("[x](&#106;avascript:alert(1))", "x");

    expect(address).toBe("javascript:alert(1)");
    expect(isSafeAddress(address ?? "")).toBe(false);
  });
});
