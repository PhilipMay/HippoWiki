import { describe, expect, it } from "vitest";

import {
  FUNCTION_ROLES,
  includesRole,
  isRole,
  mayDo,
  ROLE_LABELS,
  ROLES,
  type FolderFunction,
  type Role,
} from "@/features/folder-roles/roles";

describe("ROLES", () => {
  it("are ordered from Reader to Owner", () => {
    expect(ROLES).toEqual(["reader", "writer", "manager", "owner"]);
  });

  it("have labels", () => {
    expect(ROLES.map((role) => ROLE_LABELS[role])).toEqual(["Reader", "Writer", "Manager", "Owner"]);
  });
});

describe("isRole", () => {
  it("is true for the four roles", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
  });

  it("is false for anything else", () => {
    for (const value of ["", "Reader", "OWNER", " owner", "admin", null, undefined, 1, {}]) {
      expect(isRole(value), String(value)).toBe(false);
    }
  });
});

describe("includesRole", () => {
  it("is true exactly when the role is the needed one or a higher one", () => {
    const expected: Record<Role, Role[]> = {
      reader: ["reader"],
      writer: ["reader", "writer"],
      manager: ["reader", "writer", "manager"],
      owner: ["reader", "writer", "manager", "owner"],
    };
    for (const role of ROLES) {
      for (const needed of ROLES) {
        expect(includesRole(role, needed), `${role} includes ${needed}`).toBe(expected[role].includes(needed));
      }
    }
  });
});

describe("FUNCTION_ROLES", () => {
  it("names the lowest role of every function of the matrix", () => {
    expect(FUNCTION_ROLES).toEqual({
      read: "reader",
      editPage: "writer",
      moveOrRenamePage: "writer",
      deletePage: "manager",
      deletedPages: "manager",
      editTab: "manager",
      renameFolder: "owner",
      manageRoles: "owner",
    });
  });
});

describe("mayDo", () => {
  const functions = Object.keys(FUNCTION_ROLES) as FolderFunction[];

  it("allows a function from its lowest role up and refuses it below", () => {
    for (const fn of functions) {
      for (const role of ROLES) {
        expect(mayDo(role, fn), `${role} ${fn}`).toBe(ROLES.indexOf(role) >= ROLES.indexOf(FUNCTION_ROLES[fn]));
      }
    }
  });

  it("allows nothing without a role", () => {
    for (const fn of functions) {
      expect(mayDo(null, fn)).toBe(false);
      expect(mayDo(undefined, fn)).toBe(false);
    }
  });
});
