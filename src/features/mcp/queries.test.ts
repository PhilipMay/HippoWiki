import { beforeEach, describe, expect, it, vi } from "vitest";

import { listMcpAddresses } from "@/features/mcp/queries";

const mocks = vi.hoisted(() => ({ getServerEnv: vi.fn() }));

vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));

const FOLDER = { id: "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10" };
const READER = { role: "reader", address: `https://wiki.example.com/mcp/${FOLDER.id}/reader` };
const WRITER = { role: "writer", address: `https://wiki.example.com/mcp/${FOLDER.id}/writer` };
const MANAGER = { role: "manager", address: `https://wiki.example.com/mcp/${FOLDER.id}/manager` };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: "https://wiki.example.com" });
});

describe("listMcpAddresses", () => {
  it("gives a Reader only the full Reader address", () => {
    expect(listMcpAddresses(FOLDER, "reader")).toEqual([READER]);
  });

  it("gives a Writer the Reader and the Writer address", () => {
    expect(listMcpAddresses(FOLDER, "writer")).toEqual([READER, WRITER]);
  });

  it.each(["manager", "owner"] as const)("gives a %s the Reader, the Writer and the Manager address", (role) => {
    expect(listMcpAddresses(FOLDER, role)).toEqual([READER, WRITER, MANAGER]);
  });

  it("gives no address without a role", () => {
    expect(listMcpAddresses(FOLDER, null)).toEqual([]);
  });

  it("gives null without HIPPOWIKI_PUBLIC_URL, when there is no MCP server", () => {
    mocks.getServerEnv.mockReturnValue({ HIPPOWIKI_PUBLIC_URL: undefined });

    expect(listMcpAddresses(FOLDER, "owner")).toBeNull();
  });
});
