import { describe, expect, it } from "vitest";

import { hashPassword, MAX_CONCURRENT_HASHES, MAX_HASH_WAIT_MS, verifyPassword } from "@/lib/password-hash";

describe("hashPassword and verifyPassword", () => {
  it("hashes with Argon2id, 19 MiB of memory, 2 iterations and 1 lane", async () => {
    expect(await hashPassword("correct horse")).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("verifies a hash with its password and not with another one", async () => {
    const hash = await hashPassword("correct horse");

    expect(await verifyPassword(hash, "correct horse")).toBe(true);
    expect(await verifyPassword(hash, "correct horsf")).toBe(false);
  });

  it("gives two hashes of the same password different salts", async () => {
    expect(await hashPassword("correct horse")).not.toBe(await hashPassword("correct horse"));
  });

  it("keeps the spaces at both ends of a password", async () => {
    const hash = await hashPassword("  spaced out  ");

    expect(await verifyPassword(hash, "  spaced out  ")).toBe(true);
    expect(await verifyPassword(hash, "spaced out")).toBe(false);
    expect(await verifyPassword(hash, "  spaced out")).toBe(false);
  });

  it("keeps non-Latin letters as they are, without normalising them", async () => {
    // "é" as one code point; the same letter as "e" with a combining accent is another password.
    const hash = await hashPassword("пароль-密碼-é");

    expect(await verifyPassword(hash, "пароль-密碼-é")).toBe(true);
    expect(await verifyPassword(hash, "пароль-密碼-é")).toBe(false);
  });

  it("uses all 128 characters of a long password", async () => {
    const password = "a".repeat(128);
    const hash = await hashPassword(password);

    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, "a".repeat(127))).toBe(false);
    expect(await verifyPassword(hash, `${"a".repeat(127)}b`)).toBe(false);
  });
});

describe("the limits of the password hashing", () => {
  it("allows 4 hashes at the same time and a wait of 10 seconds", () => {
    expect(MAX_CONCURRENT_HASHES).toBe(4);
    expect(MAX_HASH_WAIT_MS).toBe(10_000);
  });
});
