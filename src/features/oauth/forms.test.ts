import { describe, expect, it } from "vitest";

import {
  authorizeAddress,
  readAuthorizationFormData,
  readAuthorizationParams,
  readLifetime,
} from "@/features/oauth/forms";

const PARAMS = {
  client_id: "https://client.example/metadata.json",
  redirect_uri: "https://client.example/callback?tenant=a",
  response_type: "code",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  code_challenge_method: "S256",
  state: "a b&c=d",
  scope: "read",
  resource: "https://wiki.example.com/mcp",
};

function formData(fields: Record<string, string | File | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const each of Array.isArray(value) ? value : [value]) data.append(key, each);
  }
  return data;
}

describe("readAuthorizationParams", () => {
  it("reads the parameters of an authorization request", () => {
    expect(readAuthorizationParams(PARAMS)).toEqual(PARAMS);
  });

  it("leaves out what is missing and what is no parameter of OAuth", () => {
    expect(readAuthorizationParams({ client_id: "abc", action: "create", next: "/account" })).toEqual({
      client_id: "abc",
    });
    expect(readAuthorizationParams({})).toEqual({});
  });

  it("counts a parameter that is sent more than once as missing", () => {
    expect(
      readAuthorizationParams({ ...PARAMS, redirect_uri: ["https://client.example/callback", "https://evil.example"] }),
    ).toEqual({ ...PARAMS, redirect_uri: undefined });
  });

  it("keeps an empty value, for the service to refuse", () => {
    expect(readAuthorizationParams({ client_id: "" })).toEqual({ client_id: "" });
  });
});

describe("readAuthorizationFormData", () => {
  it("reads the parameters from the hidden fields of the consent form", () => {
    expect(readAuthorizationFormData(formData({ ...PARAMS, lifetime: "90d" }))).toEqual(PARAMS);
  });

  it("counts a field that is there more than once, and a file, as missing", () => {
    const data = formData({
      client_id: ["abc", "def"],
      redirect_uri: new File(["https://client.example/callback"], "redirect.txt"),
      state: "xyz",
    });

    expect(readAuthorizationFormData(data)).toEqual({ state: "xyz" });
  });

  it("returns nothing for an empty form", () => {
    expect(readAuthorizationFormData(new FormData())).toEqual({});
  });
});

describe("readLifetime", () => {
  it("returns the chosen lifetime as it was submitted, for the service to judge", () => {
    expect(readLifetime(formData({ lifetime: "365d" }))).toBe("365d");
    expect(readLifetime(formData({ lifetime: "forever" }))).toBe("forever");
  });

  it("counts a missing field and a file as empty", () => {
    expect(readLifetime(new FormData())).toBe("");
    expect(readLifetime(formData({ lifetime: new File(["90d"], "lifetime.txt") }))).toBe("");
  });
});

describe("authorizeAddress", () => {
  it("is the consent page with the search parameters it was asked with, which read back as they were", () => {
    const address = authorizeAddress(PARAMS);

    expect(address.startsWith("/oauth/authorize?client_id=https%3A%2F%2Fclient.example%2Fmetadata.json&")).toBe(true);
    expect(Object.fromEntries(new URL(address, "http://localhost").searchParams)).toEqual(PARAMS);
  });

  it("keeps a parameter that was sent more than once, and one that OAuth does not know", () => {
    const address = authorizeAddress({ client_id: ["abc", "def"], utm_source: "mail", empty: undefined });

    expect(address).toBe("/oauth/authorize?client_id=abc&client_id=def&utm_source=mail");
  });

  it("is the plain address without search parameters", () => {
    expect(authorizeAddress({})).toBe("/oauth/authorize");
  });
});
