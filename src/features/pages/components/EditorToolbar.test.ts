import { describe, expect, it } from "vitest";

import { INLINE_BUTTONS, LINK_BUTTON, LIST_BUTTONS, tooltipOf } from "@/features/pages/components/EditorToolbar";

/** The buttons of the toolbar with an icon, in their order. */
const BUTTONS = [...INLINE_BUTTONS, LINK_BUTTON, ...LIST_BUTTONS];

describe("the tooltips of the toolbar", () => {
  it("name each button and, for bold, italic and link, its shortcut with Ctrl", () => {
    expect(BUTTONS.map((button) => tooltipOf(button, false))).toEqual([
      "Bold (Ctrl+B)",
      "Italic (Ctrl+I)",
      "Strikethrough",
      "Inline code",
      "Link (Ctrl+K)",
      "Bullet list",
      "Numbered list",
      "Task list",
    ]);
  });

  it("show the shortcut with Cmd on an Apple platform", () => {
    expect(BUTTONS.map((button) => tooltipOf(button, true))).toEqual([
      "Bold (⌘B)",
      "Italic (⌘I)",
      "Strikethrough",
      "Inline code",
      "Link (⌘K)",
      "Bullet list",
      "Numbered list",
      "Task list",
    ]);
  });
});
