import { describe, expect, it } from "vitest";

import { pageText } from "@/features/search/text";

describe("the search text of a page", () => {
  it("holds the text of every block without the title heading, one block per line", () => {
    const { searchText } = pageText("# Backup plan\n\nThe first paragraph.\n\n## Details\n\n- one\n- two\n");
    expect(searchText).toBe("The first paragraph.\nDetails\none\ntwo");
  });

  it("holds a command of a code block and inline code", () => {
    const { searchText } = pageText(
      "# Restore\n\nRun `pg_restore --clean` first.\n\n```sh\npg_dump --format=custom hippowiki\n```\n\n    indented_command --flag\n",
    );
    expect(searchText).toContain("pg_restore --clean");
    expect(searchText).toContain("pg_dump --format=custom hippowiki");
    expect(searchText).toContain("indented_command --flag");
  });

  it("holds the addresses of links, bare links and images", () => {
    const { searchText } = pageText(
      "# Links\n\nSee [the docs](https://docs.example.org/backup), www.status.example.com and ![logo](/img/logo.png).\n",
    );
    expect(searchText).toContain("https://docs.example.org/backup");
    expect(searchText).toContain("the docs");
    expect(searchText).toContain("www.status.example.com");
    expect(searchText).toContain("/img/logo.png");
    expect(searchText).toContain("logo");
  });

  it("keeps raw HTML as text", () => {
    const { searchText } = pageText("# HTML\n\n<script>alert(1)</script>\n\nInline <b>bold</b>\n");
    expect(searchText).toBe("<script>alert(1)</script>\nInline <b>bold</b>");
  });

  it("holds the first heading when it is no title", () => {
    expect(pageText("Text before\n\n# Heading\n").searchText).toBe("Text before\nHeading");
    expect(pageText("## Not a title\n\nText\n").searchText).toBe("Not a title\nText");
  });

  it("holds no control character but the line breaks between blocks", () => {
    const { searchText } = pageText(
      "# Title\n\nA\u0001B\u0002C\u0000D\u007f\tE\n\n```\nline one\nline\u0002two\n```\n",
    );
    // markdown-it replaces NUL by U+FFFD, as CommonMark asks.
    expect(searchText).toBe("A B C\ufffdD  E\nline one line two");
    expect(searchText).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
  });

  it("holds the cells of a table", () => {
    expect(pageText("# Table\n\n| Host | Port |\n| --- | --- |\n| db1 | 5432 |\n").searchText).toBe(
      "Host\nPort\ndb1\n5432",
    );
  });

  it("is empty for a page of a title only", () => {
    expect(pageText("# Title\n").searchText).toBe("");
  });
});

describe("the prose of a page", () => {
  it("holds the title and the text", () => {
    expect(pageText("# Sicherung\n\nJede Nacht um zwei Uhr.\n").prose).toBe("Sicherung\nJede Nacht um zwei Uhr.");
  });

  it("holds no code, inline code or address", () => {
    const { prose } = pageText(
      [
        "# Wiederherstellung",
        "",
        "Starte `pg_restore --clean` und lies [die Anleitung](https://docs.example.org/restore).",
        "",
        "Siehe www.status.example.com und ![das Logo](/img/logo.png).",
        "",
        "```sh",
        "pg_dump --format=custom hippowiki",
        "```",
      ].join("\n"),
    );
    expect(prose).toBe("Wiederherstellung\nStarte   und lies die Anleitung.\nSiehe  und das Logo.");
  });

  it("holds a file name in running text but no `www.` address", () => {
    const { searchText, prose } = pageText("# Notes\n\nEdit README.md first, then see www.example.org.\n");
    expect(prose).toBe("Notes\nEdit README.md first, then see .");
    expect(searchText).toContain("README.md");
    expect(searchText).toContain("www.example.org");
  });

  it("removes the control characters", () => {
    expect(pageText("# Title\n\nA\u0001B\n").prose).toBe("Title\nA B");
  });
});

describe("the text of a wiki link", () => {
  it("is its label in the search text and the prose", () => {
    const { searchText, prose } = pageText("# Links\n\nRead [[setup|the setup]] first.");
    expect(searchText).toBe("Read the setup first.");
    expect(prose).toBe("Links\nRead the setup first.");
  });

  it("is its target as written in the search text only, without a label", () => {
    const { searchText, prose } = pageText("# Links\n\nRead [[guides/setup]] first.");
    expect(searchText).toBe("Read guides/setup first.");
    expect(prose).toBe("Links\nRead   first.");
  });
});
