// The type of an account: an admin manages the accounts and sees no content, a user works with the content and
// manages no accounts. The type is chosen when the account is created and never changes (a trigger of the database
// refuses every change). No server-only imports and not the list of common passwords, so that Client Components and
// `src/lib/addresses.ts` can import it.

/** The types of an account, in the order the "New user" dialog offers them. */
export const USER_TYPES = ["user", "admin"] as const;

/** The type of an account. */
export type UserType = (typeof USER_TYPES)[number];

/** The label of each type of an account, as the pages show it. */
export const USER_TYPE_LABELS: Readonly<Record<UserType, string>> = { user: "User", admin: "Admin" };

/** Whether the text is a type of an account. */
export function isUserType(value: unknown): value is UserType {
  return typeof value === "string" && (USER_TYPES as readonly string[]).includes(value);
}

/**
 * Whether the account is an admin. The one place that decides it, by the type and never by the name: the services ask
 * it before they list or create users and before they show or change content, and the header before it shows its
 * entries.
 */
export function isAdmin(user: { type: UserType }): boolean {
  return user.type === "admin";
}
