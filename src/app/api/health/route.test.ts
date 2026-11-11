import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({ $queryRaw: mocks.queryRaw }) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: mocks.error } }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/health", () => {
  it("reports ok while the database answers", async () => {
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("reports an error with status 503 and logs it when the database does not answer", async () => {
    const err = new Error("connection refused");
    mocks.queryRaw.mockRejectedValue(err);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "error" });
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
  });
});
