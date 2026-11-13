// Recognises the database errors that Server Actions report to the user instead of as a failed save.

import { Prisma } from "@/generated/prisma/client";

/** A unique constraint: the names of its indexes and a field that only these indexes cover. */
export type UniqueConstraint = {
  /** Index names as Prisma creates them, e.g. `Folder_name_key`. */
  indexes: readonly string[];
  /** A field of the constraint, used when the index name is unknown. */
  field: string;
};

/** The unique index on `Folder.name`, as Prisma creates it for `@unique`. */
export const FOLDER_NAME: UniqueConstraint = { indexes: ["Folder_name_key"], field: "name" };

/** The unique index on the tab name within its folder, as Prisma creates it for `@@unique`. */
export const TAB_NAME: UniqueConstraint = { indexes: ["Tab_folderId_name_key"], field: "name" };

/**
 * The unique indexes on the page name, as Prisma creates them for `@@unique`: within a tab, and among the pages placed
 * directly in a folder.
 */
export const PAGE_NAME: UniqueConstraint = {
  indexes: ["Page_tabId_name_key", "Page_folderId_name_key"],
  field: "name",
};

/**
 * The unique indexes on the user name and on the email of `User`, as Prisma creates them for `@unique`. The email is
 * derived from the name, so both stand for a taken name.
 */
export const USER_NAME: UniqueConstraint = { indexes: ["User_username_key", "User_email_key"], field: "username" };

/**
 * The unique index on the hash of an API token, as Prisma creates it for `@unique`. A token has 256 random bits, so a
 * violation means a broken token generator rather than bad luck.
 */
export const API_TOKEN_HASH: UniqueConstraint = { indexes: ["ApiToken_tokenHash_key"], field: "tokenHash" };

/**
 * Whether the error is a violation of the given unique constraint. With a driver adapter, Prisma reports the violated
 * constraint in `meta.driverAdapterError.cause.constraint`: as the index name or, if that is unknown, as the fields.
 */
export function isUniqueViolation(err: unknown, { indexes, field }: UniqueConstraint): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const adapterError = err.meta?.driverAdapterError as
    { cause?: { constraint?: { index?: string; fields?: string[] } } } | undefined;
  const constraint = adapterError?.cause?.constraint;
  if (constraint?.index !== undefined) return indexes.includes(constraint.index);
  return constraint?.fields?.includes(field) ?? false;
}

/** A foreign key: the names of its constraints and the column that only these constraints cover. */
export type ForeignKey = {
  /** Constraint names as Prisma creates them, e.g. `Page_lastEditedById_fkey`. */
  constraints: readonly string[];
  /** The column of the key, used when the constraint name is unknown. */
  field: string;
};

/** The foreign keys of the last editor of folders, tabs and pages, as Prisma creates them for the relations to `User`. */
export const LAST_EDITOR: ForeignKey = {
  constraints: ["Folder_lastEditedById_fkey", "Tab_lastEditedById_fkey", "Page_lastEditedById_fkey"],
  field: "lastEditedById",
};

/**
 * Whether the error is a foreign key violation, e.g. a row that refers to a folder that no longer exists; with a key,
 * whether it is a violation of that key. With the `pg` driver adapter, Prisma reports the violated key in
 * `meta.driverAdapterError.cause.constraint`: as the constraint name (`index`) or, if PostgreSQL names a column, as
 * the fields.
 */
export function isForeignKeyViolation(err: unknown, key?: ForeignKey): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2003") return false;
  if (key === undefined) return true;
  const adapterError = err.meta?.driverAdapterError as
    { cause?: { constraint?: { index?: string; fields?: string[] } } } | undefined;
  const constraint = adapterError?.cause?.constraint;
  if (constraint?.index !== undefined) return key.constraints.includes(constraint.index);
  return constraint?.fields?.includes(key.field) ?? false;
}
