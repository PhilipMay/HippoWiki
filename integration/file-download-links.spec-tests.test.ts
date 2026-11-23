// Tests of signed file links written from the spec alone (spec/signed-file-links.md), against the test database:
// that handing out a link stores nothing, and that a link ends with its grant although the link itself has not
// expired. The other rules are checked by integration/file-link-service.test.ts, integration/file-link-key.test.ts
// and integration/grant-service.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inMcp } from "@/features/folder-roles/actors";
import { createFileLink, getLinkedFileContent, getLinkKey } from "@/features/files/link-service";
import type { File, FileVersion, Folder, User } from "@/generated/prisma/client";

import {
  createFile,
  createFolder,
  createGrant,
  createUser,
  getTestDb,
  signFileLinkToken,
} from "../e2e/support/database";

let alice: User;
let folder: Folder;
let file: File & { versions: FileVersion[] };

beforeEach(async () => {
  alice = await createUser({ name: "alice", mustChangePassword: false });
  folder = await createFolder({ name: "handbook", roles: [{ user: alice, role: "owner" }] });
  file = await createFile({ folder, name: "diagram.png", editor: alice });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Every row of every table of the test database, as sorted JSON, to compare the whole database before and after. */
async function allRows(): Promise<Record<string, string[]>> {
  const db = getTestDb();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const rows: Record<string, string[]> = {};
  for (const { tablename } of tables) {
    // Each row as text in the database, so that columns Prisma cannot read, such as the vectors of search, compare too.
    const found = await db.$queryRawUnsafe<{ row: string }[]>(
      `SELECT row_to_json(t)::text AS row FROM "public"."${tablename.replaceAll('"', '""')}" AS t`,
    );
    rows[tablename] = found.map(({ row }) => row).sort();
  }
  return rows;
}

/** Reads the file by the link, closing its content; `null` if the link is refused. */
async function download(token: string): Promise<Buffer | null> {
  const linked = await getLinkedFileContent(token, "handbook", null, "diagram.png");
  if (!linked) return null;
  return Buffer.from(await new Response(linked.content.blob.stream).arrayBuffer());
}

describe("signed file links", () => {
  // spec/signed-file-links.md, "The tool": handing out a link stores nothing
  it("handing out a link writes no row to the database", async () => {
    const { grant } = await createGrant({ owner: alice, folder });
    const actor = inMcp(
      { id: alice.id, name: alice.name, type: alice.type },
      { grantId: grant.id, folderId: folder.id, role: "reader" },
    );
    // The key of the links is generated once, on its first use, and is no row of a link.
    await getLinkKey();
    const before = await allRows();

    const first = await createFileLink(actor, "handbook", null, "diagram.png");
    const second = await createFileLink(actor, "handbook", null, "diagram.png");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(await allRows()).toEqual(before);
  });

  // spec/signed-file-links.md, "Downloading with a link": a link never outlives its grant
  it("the end of the grant ends a link that has not expired", async () => {
    const { grant } = await createGrant({ owner: alice, folder, expiresAt: new Date(Date.now() + 60_000) });
    const [version] = file.versions;
    if (!version) throw new Error("no version");
    // The link expires ten minutes from now, after the grant.
    const token = await signFileLinkToken({ grant: grant.id, version: version.id });
    expect(await download(token)).not.toBeNull();

    vi.useFakeTimers({ now: grant.expiresAt.getTime() + 1000, toFake: ["Date"] });

    expect(await download(token)).toBeNull();
  });
});
