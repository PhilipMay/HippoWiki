import { beforeEach, describe, expect, it, vi } from "vitest";

import { isOAuthOn, issuer, mcpResourceOf } from "@/features/oauth/issuer";

const mocks = vi.hoisted(() => ({ getServerEnv: vi.fn() }));

vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));

const FOLDER_ID = "3a5c7e90-1b2d-4f6a-8c0e-2d4f6a8c0e11";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("isOAuthOn", () => {
  it("is on with the public URL, which is the issuer", () => {
    mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: "https://wiki.example.com" });

    expect(isOAuthOn()).toBe(true);
    expect(issuer()).toBe("https://wiki.example.com");
    expect(mcpResourceOf({ folderId: FOLDER_ID, role: "reader" })).toBe(
      `https://wiki.example.com/mcp/${FOLDER_ID}/reader`,
    );
  });

  it("is off without the public URL, with no issuer and no MCP address", () => {
    mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: undefined });

    expect(isOAuthOn()).toBe(false);
    expect(issuer()).toBeNull();
    expect(mcpResourceOf({ folderId: FOLDER_ID, role: "reader" })).toBeNull();
  });
});
