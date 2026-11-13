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
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
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
