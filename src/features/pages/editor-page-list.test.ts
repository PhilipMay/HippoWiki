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
      files: [],
      places: [
        { tab: null, newPageAddress: "/folders/team?action=new&name=", uploadAddress: null },
        { tab: "guides", newPageAddress: "/folders/team/guides?action=new&name=", uploadAddress: null },
        { tab: "docs", newPageAddress: "/folders/team/docs?action=new&name=", uploadAddress: null },
      ],
    });
  });

  it("gives each file the address of the file itself, an image its size, and each place its upload address", () => {
    const files = [
      { name: "diagram.png", type: "png" as const, tab: { name: "guides" }, width: 640, height: 480 },
      { name: "report.pdf", type: "pdf" as const, tab: null, width: null, height: null },
    ];
    expect(buildEditorPageList("team", [], [{ name: "guides" }], files, true)).toEqual({
      pages: [],
      files: [
        {
          tab: "guides",
          name: "diagram.png",
          address: "/files/team/guides/diagram.png",
          image: { width: 640, height: 480 },
        },
        { tab: null, name: "report.pdf", address: "/files/team/report.pdf", image: null },
      ],
      places: [
        {
          tab: null,
          newPageAddress: "/folders/team?action=new&name=",
          uploadAddress: "/folders/team?action=upload&name=",
        },
        {
          tab: "guides",
          newPageAddress: "/folders/team/guides?action=new&name=",
          uploadAddress: "/folders/team/guides?action=upload&name=",
        },
      ],
    });
  });
});
