import { describe, expect, it } from "vitest";

import {
  FUNCTION_ROLES,
  includesRole,
  isMcpRole,
  isRole,
  mayDo,
  MCP_ROLE_ABILITIES,
  MCP_ROLES,
  mcpRolesFor,
  ROLE_LABELS,
  ROLES,
  rolesFor,
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
      deleteTab: "manager",
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

describe("rolesFor", () => {
  it("lists the roles that may do the function", () => {
    expect(rolesFor("read")).toEqual(["reader", "writer", "manager", "owner"]);
    expect(rolesFor("editPage")).toEqual(["writer", "manager", "owner"]);
    expect(rolesFor("deletedPages")).toEqual(["manager", "owner"]);
    expect(rolesFor("manageRoles")).toEqual(["owner"]);
  });
});

describe("MCP_ROLES", () => {
  it("are Reader, Writer and Manager, never Owner", () => {
    expect(MCP_ROLES).toEqual(["reader", "writer", "manager"]);
  });

  it("each say in one sentence what they allow", () => {
    for (const role of MCP_ROLES) expect(MCP_ROLE_ABILITIES[role]).toMatch(/^[A-Z].+\.$/);
  });

  it("say for Manager that it deletes pages and creates, renames and deletes tabs, a tab with its pages", () => {
    expect(MCP_ROLE_ABILITIES.manager).toMatch(/delete pages/);
    expect(MCP_ROLE_ABILITIES.manager).toMatch(/create, rename and delete tabs/);
    expect(MCP_ROLE_ABILITIES.manager).toMatch(/deleting a tab deletes all its pages/);
  });
});

describe("isMcpRole", () => {
  it("is true for Reader, Writer and Manager", () => {
    expect(isMcpRole("reader")).toBe(true);
    expect(isMcpRole("writer")).toBe(true);
    expect(isMcpRole("manager")).toBe(true);
  });

  it("is false for Owner and anything else", () => {
    for (const value of ["owner", "", "Reader", "WRITER", "Manager", null, undefined, 1]) {
      expect(isMcpRole(value), String(value)).toBe(false);
    }
  });
});

describe("mcpRolesFor", () => {
  it("gives the MCP roles at most the own role", () => {
    expect(mcpRolesFor("reader")).toEqual(["reader"]);
    expect(mcpRolesFor("writer")).toEqual(["reader", "writer"]);
    expect(mcpRolesFor("manager")).toEqual(["reader", "writer", "manager"]);
    expect(mcpRolesFor("owner")).toEqual(["reader", "writer", "manager"]);
  });

  it("gives none without a role", () => {
    expect(mcpRolesFor(null)).toEqual([]);
    expect(mcpRolesFor(undefined)).toEqual([]);
  });
});
