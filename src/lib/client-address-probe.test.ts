import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_PROBE_VALUE_LENGTH,
  PROBE_HEADERS,
  logClientAddressProbe,
  readProbeHeaders,
} from "@/lib/client-address-probe";

const mocks = vi.hoisted(() => ({
  getServerEnv: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info } }));

const PROXY_SOURCE = { source: "proxy", method: "GET", path: "/folders" } as const;

function switchProbe(on: boolean): void {
  mocks.getServerEnv.mockReturnValue({
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    NODE_ENV: "production",
    HIPPOWIKI_LOG_CLIENT_ADDRESS: on,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("readProbeHeaders", () => {
  it("reads every probed header and gives null for a missing one", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 198.51.100.2", host: "wiki.example.com" });

    expect(readProbeHeaders(headers)).toEqual({
      "x-forwarded-for": "203.0.113.7, 198.51.100.2",
      "x-real-ip": null,
      forwarded: null,
      "x-forwarded-proto": null,
      "x-forwarded-host": null,
      "x-forwarded-port": null,
      host: "wiki.example.com",
    });
  });

  it("reads no other header, so neither the session cookie nor credentials reach the log", () => {
    const headers = new Headers({
      cookie: "better-auth.session_token=token.signature",
      authorization: "Basic YWRtaW46c2VjcmV0",
      "user-agent": "curl/8.0",
      "x-real-ip": "203.0.113.7",
    });

    const probed = readProbeHeaders(headers);

    expect(Object.keys(probed)).toEqual([...PROBE_HEADERS]);
    expect(JSON.stringify(probed)).not.toMatch(/session_token|YWRtaW46c2VjcmV0|curl/);
  });

  it(`cuts a value to ${MAX_PROBE_VALUE_LENGTH} characters`, () => {
    const headers = new Headers({ "x-forwarded-for": "1".repeat(MAX_PROBE_VALUE_LENGTH + 50) });

    expect(readProbeHeaders(headers)["x-forwarded-for"]).toBe("1".repeat(MAX_PROBE_VALUE_LENGTH));
  });
});

describe("logClientAddressProbe", () => {
  it("logs nothing while the probe is switched off", () => {
    switchProbe(false);

    logClientAddressProbe(new Headers({ "x-forwarded-for": "203.0.113.7" }), PROXY_SOURCE);

    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("logs one info line with the source and the probed headers while the probe is switched on", () => {
    switchProbe(true);
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7", cookie: "better-auth.session_token=secret" });

    logClientAddressProbe(headers, PROXY_SOURCE);

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { ...PROXY_SOURCE, headers: readProbeHeaders(headers) },
      "client address probe",
    );
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("secret");
  });

  it("logs the login source without a method or path", () => {
    switchProbe(true);
    const headers = new Headers({ "x-real-ip": "203.0.113.7" });

    logClientAddressProbe(headers, { source: "login" });

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { source: "login", headers: readProbeHeaders(headers) },
      "client address probe",
    );
  });
});
