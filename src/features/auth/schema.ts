// The input of the login. No server-only imports, so Client Components can use it.

import { z } from "zod";

import { PASSWORD_MAX_LENGTH, userNameSchema } from "@/features/users/schema";

/**
 * What a login needs to be worth a look at the stored password: a name that follows the name rule and a password of
 * at most 128 characters. Anything else cannot belong to a user, so the service answers it like a wrong password,
 * without computing a hash. The lower limit of a password is not checked: it is a rule for new passwords.
 */
export const loginInputSchema = z.object({
  name: userNameSchema,
  password: z
    .string()
    .min(1)
    // The length of the string, as Better Auth counts it; `.max()` of Zod counts code points.
    .refine((password) => password.length <= PASSWORD_MAX_LENGTH),
});

/** A user name and a password that may belong to a user. */
export type LoginInput = z.output<typeof loginInputSchema>;
