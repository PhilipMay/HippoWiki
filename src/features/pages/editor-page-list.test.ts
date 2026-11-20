import { describe, expect, it } from "vitest";

import { buildEditorPageList } from "@/features/pages/editor-page-list";

describe("buildEditorPageList", () => {
  it("gives each page its address and each place the address of a new page there without the name", () => {
    const pages = [
      { name: "setup", title: "Setup", tab: null },
      { name: "setup", title: "Setup guide", tab: { name: "guides" } },
    ];
    expect(buildEditorPageList("team", pages, [{ name: "guides" }, { name: "docs" }])).toEqual({
      pages: [
        { tab: null, name: "setup", title: "Setup", address: "/folders/team/setup.md" },
        { tab: "guides", name: "setup", title: "Setup guide", address: "/folders/team/guides/setup.md" },
      ],
      places: [
        { tab: null, newPageAddress: "/folders/team?action=new&name=" },
        { tab: "guides", newPageAddress: "/folders/team/guides?action=new&name=" },
        { tab: "docs", newPageAddress: "/folders/team/docs?action=new&name=" },
      ],
    });
  });
});
