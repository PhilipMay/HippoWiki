// The validation of a role. No server-only imports, so the server and the tests can use it anywhere.

import { z } from "zod";

import { ROLES, type Role } from "@/features/folder-roles/roles";

export const ROLE_MESSAGE = "Choose a role";

/**
 * A role of a user on a folder. It has no default: a request without a role or with an unknown one is refused, so that
 * a broken or crafted request is noticed instead of giving a role nobody chose.
 */
export const roleSchema = z.enum(ROLES, { error: ROLE_MESSAGE });

/** Returns the role if the value is exactly one of the roles, otherwise `null`. */
export function parseRole(value: unknown): Role | null {
  const result = roleSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const USER_REQUIRED_MESSAGE = "Choose a user";

/** Input for giving a role: the name of the user who gets it, and the role. */
export const giveRoleInputSchema = z.object({
  user: z.string().trim().min(1, USER_REQUIRED_MESSAGE),
  role: roleSchema,
});

/** A validated "Give role" input. */
export type GiveRoleInput = z.output<typeof giveRoleInputSchema>;

export type GiveRoleFieldErrors = { user?: string[]; role?: string[] };
