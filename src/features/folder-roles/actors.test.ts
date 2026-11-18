import { beforeEach, describe, expect, it, vi } from "vitest";

import { channelOf, inBrowser, inMcp, openContentWrite, refusedByRole } from "@/features/folder-roles/actors";
import {
  ACTOR,
  ACTOR_ID,
  ADMIN,
  FOLDER_ID,
  GRANT_ID,
  MALFORMED_ACTOR,
  MALFORMED_ID,
  MCP_ACTOR,
  USER,
} from "@/test/unit";

const mocks = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn, error: mocks.error } }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("inBrowser and inMcp", () => {
  it("give the user the channel and, through MCP, the connection, and nothing else of the session", () => {
    const sessionUser = { ...USER, mustChangePassword: false, email: "alice@users.hippowiki.invalid" };
    const connection = { grantId: GRANT_ID, folderId: FOLDER_ID, role: "writer" as const };

    expect(inBrowser(sessionUser)).toStrictEqual({ ...USER, channel: "web" });
    expect(inMcp(sessionUser, { ...connection, extra: "x" } as typeof connection)).toStrictEqual({
      ...USER,
      channel: "mcp",
      connection,
    });
  });
});

describe("channelOf", () => {
  it("is web for the actor of the browser and mcp with the grant for the actor of MCP", () => {
    expect(channelOf(ACTOR)).toStrictEqual({ channel: "web" });
    expect(channelOf(MCP_ACTOR)).toStrictEqual({ channel: "mcp", grantId: GRANT_ID });
  });
});

describe("openContentWrite", () => {
  it("refuses an admin with not-allowed and logs it, before the id is looked at", () => {
    expect(openContentWrite({ ...ADMIN, id: MALFORMED_ID }, "page not saved")).toStrictEqual({
      refused: { ok: false, error: { code: "not-allowed" } },
    });
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { actorId: MALFORMED_ID },
      "page not saved: the actor is an admin",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("refuses a malformed actor id with failed and logs it", () => {
    expect(openContentWrite(MALFORMED_ACTOR, "page not saved")).toStrictEqual({
      refused: { ok: false, error: { code: "failed" } },
    });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith({ actorId: MALFORMED_ID }, "malformed actor id");
  });

  it("gives the actor of the browser as the last editor with the channel web", () => {
    expect(openContentWrite(ACTOR, "page not saved")).toStrictEqual({
      editor: { lastEditedById: ACTOR_ID, lastEditedVia: "web" },
    });
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("gives the actor of MCP as the last editor with the channel mcp", () => {
    expect(openContentWrite(MCP_ACTOR, "page not saved")).toStrictEqual({
      editor: { lastEditedById: ACTOR_ID, lastEditedVia: "mcp" },
    });
  });
});

describe("refusedByRole", () => {
  it("passes a role that allows the function, and refuses no role and a lower role, logged with the target", () => {
    expect(refusedByRole(ACTOR, "tab not deleted", "manager", "deleteTab", { folderId: FOLDER_ID })).toBeNull();

    expect(refusedByRole(ACTOR, "tab not deleted", null, "deleteTab", { folderId: FOLDER_ID })).toStrictEqual({
      ok: false,
      error: { code: "not-allowed" },
    });
    expect(refusedByRole(ACTOR, "tab not deleted", "writer", "deleteTab", { folderId: FOLDER_ID })).toStrictEqual({
      ok: false,
      error: { code: "not-allowed" },
    });
    expect(mocks.warn.mock.calls).toStrictEqual([
      [{ actorId: ACTOR_ID, folderId: FOLDER_ID }, "tab not deleted: the actor has no role on the folder"],
      [
        { actorId: ACTOR_ID, folderId: FOLDER_ID, role: "writer" },
        "tab not deleted: the role of the actor does not allow it",
      ],
    ]);
  });
});
