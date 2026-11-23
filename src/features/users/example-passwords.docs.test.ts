// The public files of the repository give no admin password that the admin setup would accept: every value of
// HIPPOWIKI_ADMIN_PASSWORD in `.env.example` and `README.md` is empty or a placeholder that `ensureAdmin()` refuses.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { adminPasswordSchema } from "@/features/users/schema";

/** Every value given to HIPPOWIKI_ADMIN_PASSWORD in the file, without the quotes around it. */
function adminPasswordsIn(file: string): string[] {
  const text = readFileSync(path.join(process.cwd(), file), "utf8");
  const values = [...text.matchAll(/HIPPOWIKI_ADMIN_PASSWORD=('[^']*'|"[^"]*"|\S*)/g)].map((match) => match[1] ?? "");
  return values.map((value) => value.replace(/^(['"])([\s\S]*)\1$/, "$2"));
}

describe.each([".env.example", "README.md"])("the admin passwords of %s", (file) => {
  const passwords = adminPasswordsIn(file);

  it("are found", () => {
    expect(passwords.length).toBeGreaterThan(0);
  });

  it("are empty or refused by the admin setup", () => {
    for (const password of passwords) {
      expect(password === "" || !adminPasswordSchema.safeParse(password).success, password).toBe(true);
    }
  });
});
