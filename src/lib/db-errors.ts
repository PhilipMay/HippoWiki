// Recognises the database errors that a service answers with a code of its own instead of as a failed write: the
// violations of the unique constraints and foreign keys that a user can cause, the refusals of the triggers, and a
// statement stopped by its time limit. The services call it; the adapters only map the codes.

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
 * The unique indexes on the file name, as Prisma creates them for `@@unique`: within a tab, and among the files placed
 * directly in a folder. A file and a page of the same name without the extension sit side by side.
 */
export const FILE_NAME: UniqueConstraint = {
  indexes: ["File_tabId_name_key", "File_folderId_name_key"],
  field: "name",
};

/**
 * The unique index on the file and the number of a version, as Prisma creates it for `@@unique`. A new version locks
 * the row of its file before it numbers the version, so a violation means that another write took the number first.
 */
export const FILE_VERSION_NUMBER: UniqueConstraint = {
  indexes: ["FileVersion_fileId_number_key"],
  field: "number",
};

/**
 * The unique index on the page and the number of a revision, as Prisma creates it for `@@unique`. A content save locks
 * the row of its page before it numbers its revision, so a violation means that another write took the number first.
 */
export const PAGE_REVISION_NUMBER: UniqueConstraint = {
  indexes: ["PageRevision_pageId_number_key"],
  field: "number",
};

/**
 * The unique indexes on the user name and on the email of `User`, as Prisma creates them for `@unique`. The email is
 * derived from the name, so both stand for a taken name.
 */
export const USER_NAME: UniqueConstraint = { indexes: ["User_username_key", "User_email_key"], field: "username" };

/**
 * The unique index on the URL of the metadata document of an OAuth client, as Prisma creates it for `@unique`. Two
 * requests that fetch the document of a new client at the same time both try to store it.
 */
export const OAUTH_CLIENT_METADATA_URL: UniqueConstraint = {
  indexes: ["OAuthClient_metadataUrl_key"],
  field: "metadataUrl",
};

/**
 * The unique index on the folder and the user of a role, as Prisma creates it for `@@unique`: a user holds at most one
 * role per folder.
 */
export const FOLDER_ROLE_USER: UniqueConstraint = { indexes: ["FolderRole_folderId_userId_key"], field: "userId" };

/**
 * Whether the error is a violation of the given unique constraint. With a driver adapter, Prisma reports the violated
 * constraint in `meta.driverAdapterError.cause.constraint`: as the index name or, if that is unknown, as the fields.
 */
export function isUniqueViolation(err: unknown, { indexes, field }: UniqueConstraint): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  return isConstraint(err, indexes, field);
}

/**
 * Whether the violated constraint of the error is one of the given names, or, if its name is unknown, covers the
 * field. With the `pg` driver adapter, Prisma reports it in `meta.driverAdapterError.cause.constraint`: as the name
 * (`index`) or as the fields.
 */
function isConstraint(err: Prisma.PrismaClientKnownRequestError, names: readonly string[], field: string): boolean {
  const adapterError = err.meta?.driverAdapterError as
    { cause?: { constraint?: { index?: string; fields?: string[] } } } | undefined;
  const constraint = adapterError?.cause?.constraint;
  if (constraint?.index !== undefined) return names.includes(constraint.index);
  return constraint?.fields?.includes(field) ?? false;
}

/** A foreign key: the names of its constraints and the column that only these constraints cover. */
export type ForeignKey = {
  /** Constraint names as Prisma creates them, e.g. `Page_lastEditedById_fkey`. */
  constraints: readonly string[];
  /** The column of the key, used when the constraint name is unknown. */
  field: string;
};

/**
 * The foreign keys of the last editor of folders, tabs, pages and files, as Prisma creates them for the relations to
 * `User`, and those of the user of a page revision and of a file version, who is always the last editor of the same
 * write.
 */
export const LAST_EDITOR: ForeignKey = {
  constraints: [
    "Folder_lastEditedById_fkey",
    "Tab_lastEditedById_fkey",
    "Page_lastEditedById_fkey",
    "PageRevision_userId_fkey",
    "File_lastEditedById_fkey",
    "FileVersion_userId_fkey",
  ],
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
  return isConstraint(err, key.constraints, key.field);
}

/** The SQLSTATE of a `check_violation`, which the triggers of the migrations raise. */
const CHECK_VIOLATION = "23514";

/** The message of the trigger that refuses a role of an admin (`prisma/migrations/20261116103037_init/`). */
const ADMIN_ROLE_MESSAGE = "an admin cannot have a role on a folder";

/**
 * Whether the error is the refusal of the trigger that keeps admins without a role on any folder. Prisma reports an
 * error that a trigger raises with a code of its own, which differs between writes, so only the PostgreSQL error in
 * `meta.driverAdapterError.cause` is read: its SQLSTATE and its message.
 */
export function isAdminRoleViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const adapterError = err.meta?.driverAdapterError as { cause?: { code?: string; message?: string } } | undefined;
  const cause = adapterError?.cause;
  return cause?.code === CHECK_VIOLATION && cause.message === ADMIN_ROLE_MESSAGE;
}

/** The SQLSTATE of a `query_canceled`, which PostgreSQL raises for a statement stopped by `statement_timeout`. */
const QUERY_CANCELED = "57014";

/**
 * Whether the error is a statement that PostgreSQL stopped, as it stops one that runs longer than its
 * `statement_timeout`. Only the PostgreSQL error in `meta.driverAdapterError.cause` is read, as for the triggers.
 */
export function isStatementTimeout(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const adapterError = err.meta?.driverAdapterError as { cause?: { code?: string } } | undefined;
  return adapterError?.cause?.code === QUERY_CANCELED;
}
