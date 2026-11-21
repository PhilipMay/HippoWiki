import { describe, expect, it } from "vitest";

import { suggestFileName } from "@/features/files/derive";
import { NAME_MAX_LENGTH } from "@/lib/name-limits";
import { parseFileName } from "@/lib/names";

describe("suggestFileName", () => {
  it("suggests the name of the name rule with the extension in lower case", () => {
    expect(suggestFileName("Network Diagram (v2).PNG")).toBe("network-diagram-v2.png");
    expect(suggestFileName("Übersicht Größen.pdf")).toBe("uebersicht-groessen.pdf");
    expect(suggestFileName("screenshot.webp")).toBe("screenshot.webp");
    expect(suggestFileName("Animation.GIF")).toBe("animation.gif");
  });

  it("suggests .jpg for a JPEG uploaded with .jpeg", () => {
    expect(suggestFileName("photo.jpeg")).toBe("photo.jpg");
    expect(suggestFileName("Photo.JPEG")).toBe("photo.jpg");
    expect(suggestFileName("photo.jpg")).toBe("photo.jpg");
  });

  it("joins the dots before the extension into the name", () => {
    expect(suggestFileName("release.notes.v2.pdf")).toBe("release-notes-v2.pdf");
  });

  it("suggests the name alone without the extension of an accepted type", () => {
    expect(suggestFileName("drawing.svg")).toBe("drawing");
    expect(suggestFileName("README")).toBe("readme");
  });

  it("suggests nothing when the name leaves nothing usable", () => {
    expect(suggestFileName("日本語.png")).toBe("");
    expect(suggestFileName(".png")).toBe("");
  });

  it("suggests a name within the limit that follows the rule", () => {
    const suggestion = suggestFileName(`${"word ".repeat(40)}.png`);
    expect(parseFileName(suggestion)?.base.length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
  });
});
