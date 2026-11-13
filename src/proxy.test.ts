import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

const mocks = vi.hoisted(() => ({
  logClientAddressProbe: vi.fn(),
}));

vi.mock("@/lib/client-address-probe", () => ({ logClientAddressProbe: mocks.logClientAddressProbe }));

const SESSION_COOKIE = "better-auth.session_token=token.signature";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("proxy", () => {
  it("hands a request without a session cookie to the probe and still sends it to the login page", () => {
    const request = new NextRequest("http://localhost:3000/folders/notes", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });

    const response = proxy(request);

    expect(mocks.logClientAddressProbe).toHaveBeenCalledExactlyOnceWith(request.headers, {
      source: "proxy",
      method: "GET",
      path: "/folders/notes",
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2Ffolders%2Fnotes");
  });

  it.each([
    ["/account?action=create", "/login?next=%2Faccount%3Faction%3Dcreate"],
    [
      "/oauth/authorize?client_id=abc&state=x%2Fy",
      "/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dabc%26state%3Dx%252Fy",
    ],
    ["/", "/login?next=%2F"],
    // The folder list is where a login leads anyway.
    ["/folders", "/login"],
  ])("sends a read of %s without a session cookie to %s, the login page with the way back", (address, location) => {
    for (const method of ["GET", "HEAD"]) {
      const response = proxy(new NextRequest(`http://localhost:3000${address}`, { method }));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`http://localhost:3000${location}`);
    }
  });

  it("the way back of a read is the address that was asked for", () => {
    const address = "/oauth/authorize?client_id=abc&state=x%2Fy&scope=read+write";

    const response = proxy(new NextRequest(`http://localhost:3000${address}`));

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("next")).toBe(address);
  });

  it("sends a read of an address of more than 2048 characters to the login page without a way back", () => {
    const response = proxy(new NextRequest(`http://localhost:3000/${"a".repeat(2048)}`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "sends a %s without a session cookie to the login page with 303 and without a way back",
    (method) => {
      const response = proxy(new NextRequest("http://localhost:3000/account?action=create", { method }));

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    },
  );

  it("answers a Server Action without a session cookie with the login page in a header, without a way back", () => {
    const request = new NextRequest("http://localhost:3000/account?action=create", {
      method: "POST",
      headers: { "next-action": "0123456789abcdef" },
    });

    const response = proxy(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("x-action-redirect")).toBe("/login;push");
    expect(response.headers.get("location")).toBeNull();
  });

  it("hands a request with a session cookie to the probe and lets it pass", () => {
    const request = new NextRequest("http://localhost:3000/folders", {
      method: "POST",
      headers: { cookie: SESSION_COOKIE },
    });

    const response = proxy(request);

    expect(mocks.logClientAddressProbe).toHaveBeenCalledExactlyOnceWith(request.headers, {
      source: "proxy",
      method: "POST",
      path: "/folders",
    });
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
