// Runs the key of the links to files against the test database: generated once, shared by every process, and withdrawn
// by deleting its row.
import { beforeEach, describe, expect, it } from "vitest";

import { forgetLinkKey, getLinkKey } from "@/features/files/link-service";
import { checkLinkToken, signLinkToken } from "@/features/files/link-token";

import { getTestDb, storeAuthSecret } from "../e2e/support/database";

const LINK = { grant: crypto.randomUUID(), version: crypto.randomUUID(), exp: 1_800_000_000 };

beforeEach(async () => {
  await getTestDb().fileLinkKey.deleteMany();
  forgetLinkKey();
});

describe("the key of the links to files", () => {
  it("is generated on first use as 32 random bytes and stored", async () => {
    const key = await getLinkKey();

    expect(key).toHaveLength(32);
    const rows = await getTestDb().fileLinkKey.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(1);
    expect(Buffer.from(rows[0]?.secret ?? "", "hex")).toEqual(key);
  });

  it("is the same for another process and after a restart", async () => {
    const key = await getLinkKey();
    const token = signLinkToken(key, LINK);
    forgetLinkKey();

    expect(await getLinkKey()).toEqual(key);
    expect(checkLinkToken(await getLinkKey(), token).ok).toBe(true);
  });

  it("is the same for two processes that read it at once before it is stored", async () => {
    const first = getLinkKey();
    forgetLinkKey();
    const second = getLinkKey();

    expect(await first).toEqual(await second);
    expect(await getTestDb().fileLinkKey.count()).toBe(1);
  });

  it("differs from the secret of the session cookies", async () => {
    // The secret of the session cookies is kept between the tests; it is stored here if no test stored it yet.
    if ((await getTestDb().authSecret.count()) === 0) await storeAuthSecret();
    const key = await getLinkKey();
    const { secret } = await getTestDb().authSecret.findUniqueOrThrow({ where: { id: 1 }, select: { secret: true } });

    expect(secret).not.toBe(key.toString("hex"));
  });

  it("is generated anew after its row is deleted and the server restarted, so that earlier links no longer pass", async () => {
    const oldKey = await getLinkKey();
    const token = signLinkToken(oldKey, LINK);

    await getTestDb().fileLinkKey.deleteMany();
    forgetLinkKey();
    const newKey = await getLinkKey();

    expect(newKey).not.toEqual(oldKey);
    expect(checkLinkToken(newKey, token)).toStrictEqual({ ok: false, reason: "bad-signature" });
    expect(checkLinkToken(newKey, signLinkToken(newKey, LINK)).ok).toBe(true);
  });

  it("allows a single row only", async () => {
    await getLinkKey();

    await expect(getTestDb().fileLinkKey.create({ data: { id: 2, secret: "00" } })).rejects.toThrow();
  });
});
