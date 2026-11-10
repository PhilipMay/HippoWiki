import { describe, expect, it } from "vitest";

import { createLogger } from "@/lib/logger";

describe("createLogger", () => {
  it("logs debug messages in development", () => {
    expect(createLogger("development").level).toBe("debug");
  });

  it("logs from info upwards in production", () => {
    expect(createLogger("production").level).toBe("info");
  });
});
