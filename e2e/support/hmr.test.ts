import { describe, expect, it } from "vitest";

import { withoutReloads } from "./hmr";

describe("withoutReloads", () => {
  it("drops reloadPage", () => {
    expect(withoutReloads(JSON.stringify({ type: "reloadPage", data: "HMR hash mismatch" }))).toBeNull();
  });

  it("drops a turbopack-message with only a restart", () => {
    const message = { type: "turbopack-message", data: [{ type: "restart" }], hmrVersion: "3" };

    expect(withoutReloads(JSON.stringify(message))).toBeNull();
  });

  it("keeps only the partial update of a turbopack-message with a restart and a partial update, and every other field", () => {
    const partial = { resource: { path: "static/chunks/app.js", headers: {} }, type: "partial", instruction: {} };
    const message = { type: "turbopack-message", data: [{ type: "restart" }, partial], hmrVersion: "3" };

    const kept = withoutReloads(JSON.stringify(message));

    expect(typeof kept).toBe("string");
    expect(JSON.parse(kept as string)).toStrictEqual({ type: "turbopack-message", data: [partial], hmrVersion: "3" });
  });

  it("returns a turbopack-message without a restart as the same text", () => {
    const text = JSON.stringify({ type: "turbopack-message", data: [{ type: "partial", instruction: {} }] });

    expect(withoutReloads(text)).toBe(text);
  });

  it.each([
    ["building", JSON.stringify({ type: "building" })],
    ["built", JSON.stringify({ type: "built", hash: "abc" })],
    ["sync", JSON.stringify({ type: "sync", hash: "abc", errors: [], warnings: [] })],
    ["turbopack-connected", JSON.stringify({ type: "turbopack-connected", data: { sessionId: 1 } })],
    ["a text that is no JSON", "not json {"],
  ])("returns %s unchanged", (_, text) => {
    expect(withoutReloads(text)).toBe(text);
  });

  it("returns a binary message unchanged", () => {
    const binary = Buffer.from([1, 2, 3]);

    expect(withoutReloads(binary)).toBe(binary);
  });
});
