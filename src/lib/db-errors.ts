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

/** Whether the error is a foreign key violation, e.g. a row that refers to a folder that no longer exists. */
export function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003";
}
