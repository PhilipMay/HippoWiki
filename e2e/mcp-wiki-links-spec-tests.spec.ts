// Tests of MCP written from the requirements of the wiki links of files alone (`spec/mcp-wiki-links-requirements.md`),
// for what only the browser shows: the link fields of a file that the tools return hold the same texts as the copy
// fields of its details page, opened at the address of the details page that the tools return for it.
import { logIn, NO_STORAGE_STATE } from "./support/auth";
import { createFile, createTab } from "./support/database";
import { call, setUpProjects } from "./support/mcp";
import { expect, test } from "./support/test";

// An MCP client has no session cookie: it only has the access token of its grant. The browser logs in on its own.
test.use({ storageState: NO_STORAGE_STATE });

let projects: Awaited<ReturnType<typeof setUpProjects>>["projects"];
let owner: Awaited<ReturnType<typeof setUpProjects>>["owner"];

test.beforeEach(async () => {
  ({ projects, owner } = await setUpProjects());
});

/** A file as the read tools return it, with only what the test reads. */
type FileResult = {
  name: string;
  tab: string | null;
  detailsAddress: string;
  wikiLink: string;
  embedLink: string | null;
};

// mcp-wiki-links-requirements.md, R4 and R5: `wikiLink` is the same text as the copy field "Wiki link" of the details
// page of the file, `embedLink` the same text as its copy field "Embed link", and null for a PDF, which has no such
// field; in list_folder, search_pages and read_file alike.
test("the wiki link and embed link of a file in list_folder, search_pages and read_file are the texts of the copy fields of its details page", async ({
  page,
  request,
}) => {
  const guides = await createTab({ folder: projects, name: "guides" });
  await createFile({ tab: guides, name: "network-diagram.png" });
  await createFile({ folder: projects, name: "team-photo.jpg" });
  await createFile({ tab: guides, name: "user-manual.pdf" });

  const listed = (await call(request, "list_folder")).structuredContent as { files: FileResult[] };
  expect(listed.files).toHaveLength(3);

  await logIn(page, owner.name);
  await expect(page).toHaveURL("/folders");

  for (const [tab, name, query] of [
    ["guides", "network-diagram.png", "network"],
    [null, "team-photo.jpg", "photo"],
    ["guides", "user-manual.pdf", "manual"],
  ] as const) {
    const read = (await call(request, "read_file", { tab, file: name })).structuredContent as FileResult;
    const searched = (await call(request, "search_pages", { query })).structuredContent as { files: FileResult[] };
    const results = [
      listed.files.find((file) => file.name === name),
      searched.files.find((file) => file.name === name),
      read,
    ];

    await page.goto(read.detailsAddress);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    const wikiLink = await page.getByLabel("Wiki link", { exact: true }).inputValue();
    const embedField = page.getByLabel("Embed link", { exact: true });
    const embedLink = (await embedField.count()) === 0 ? null : await embedField.inputValue();
    expect(embedLink === null, name).toBe(name.endsWith(".pdf"));

    for (const result of results) {
      expect(result, name).toMatchObject({ wikiLink, embedLink });
    }
  }
});
