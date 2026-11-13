import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMetadataDocument, METADATA_MAX_BYTES, METADATA_TIMEOUT_MS } from "@/features/oauth/metadata-fetch";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));

vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));

const URL_OF_DOCUMENT = "https://client.example/metadata.json?v=2";
const DOCUMENT = { client_id: URL_OF_DOCUMENT, client_name: "Example", redirect_uris: ["https://client.example/cb"] };
const PUBLIC = { address: "93.184.216.34", family: 4 };

/** The options that the module passed to `https.request()`. */
type RequestOptions = {
  protocol: string;
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
  agent: boolean;
  signal: AbortSignal;
  lookup: (
    hostname: string,
    options: { all?: boolean },
    callback: (err: Error | null, address: unknown, family?: number) => void,
  ) => void;
};

/** What the server of a test answers. */
type Answer = { status?: number; headers?: Record<string, string>; body?: string | Buffer | Buffer[] };

/**
 * Lets `https.request()` answer with the given response: a stream with a status and headers, as Node passes it to the
 * callback of a request.
 */
function answerWith({ status = 200, headers = { "content-type": "application/json" }, body = "" }: Answer): void {
  mocks.request.mockImplementation((_options: RequestOptions, onResponse: (response: unknown) => void) => {
    const outgoing = new EventEmitter() as EventEmitter & { end: () => void };
    outgoing.end = () => {
      const chunks = Array.isArray(body) ? body : [Buffer.from(body)];
      const response = Object.assign(Readable.from(chunks), { statusCode: status, headers });
      onResponse(response);
    };
    return outgoing;
  });
}

function requestOptions(): RequestOptions {
  return mocks.request.mock.calls[0]?.[0] as RequestOptions;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue([PUBLIC]);
  answerWith({ body: JSON.stringify(DOCUMENT) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchMetadataDocument", () => {
  it("returns the document as parsed JSON with the Cache-Control header of its response", async () => {
    answerWith({
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "max-age=7200" },
      body: JSON.stringify(DOCUMENT),
    });

    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toEqual({
      ok: true,
      document: DOCUMENT,
      cacheControl: "max-age=7200",
    });
  });

  it("returns no Cache-Control for a response without the header", async () => {
    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toMatchObject({ ok: true, cacheControl: null });
  });

  it("asks over https on port 443 for the path and query, by the host name, without keeping the connection", async () => {
    await fetchMetadataDocument(URL_OF_DOCUMENT);

    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith("client.example", { all: true, verbatim: true });
    expect(requestOptions()).toMatchObject({
      protocol: "https:",
      hostname: "client.example",
      port: 443,
      path: "/metadata.json?v=2",
      method: "GET",
      headers: { accept: "application/json" },
      agent: false,
    });
    expect(requestOptions().signal).toBeInstanceOf(AbortSignal);
  });

  it("connects to the address that was checked, whatever host the connection asks for", async () => {
    await fetchMetadataDocument(URL_OF_DOCUMENT);

    const { lookup } = requestOptions();
    const single = vi.fn();
    lookup("client.example", {}, single);
    expect(single).toHaveBeenCalledExactlyOnceWith(null, "93.184.216.34", 4);
    // A host that resolves to another address a moment later does not change the address.
    const all = vi.fn();
    lookup("rebound.evil.example", { all: true }, all);
    expect(all).toHaveBeenCalledExactlyOnceWith(null, [{ address: "93.184.216.34", family: 4 }]);
  });

  it("uses the first address of a host with several public addresses", async () => {
    mocks.lookup.mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }, PUBLIC]);

    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toMatchObject({ ok: true });

    const callback = vi.fn();
    requestOptions().lookup("client.example", {}, callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith(null, "2606:4700:4700::1111", 6);
  });

  it.each([
    ["a loopback address", [{ address: "127.0.0.1", family: 4 }]],
    ["a private address", [{ address: "10.0.0.5", family: 4 }]],
    ["the metadata service of a cloud provider", [{ address: "169.254.169.254", family: 4 }]],
    ["the IPv6 loopback address", [{ address: "::1", family: 6 }]],
    ["a unique-local address", [{ address: "fd00::1", family: 6 }]],
    ["an IPv4-mapped loopback address", [{ address: "::ffff:127.0.0.1", family: 6 }]],
    ["a public and a private address", [PUBLIC, { address: "192.168.1.10", family: 4 }]],
    [
      "a private address after a public one of the other family",
      [
        { address: "2606:4700::1", family: 6 },
        { address: "10.0.0.1", family: 4 },
      ],
    ],
  ])("refuses a host that resolves to %s, without connecting", async (_case, addresses) => {
    mocks.lookup.mockResolvedValue(addresses);

    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toEqual({ ok: false, reason: "address-not-public" });

    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("refuses a host that does not resolve, or resolves to nothing, without connecting", async () => {
    mocks.lookup.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND client.example"));
    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toEqual({ ok: false, reason: "host-not-resolved" });
    mocks.lookup.mockResolvedValueOnce([]);
    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toEqual({ ok: false, reason: "host-not-resolved" });

    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([
    ["http", "http://client.example/metadata.json"],
    ["another port", "https://client.example:8443/metadata.json"],
    ["credentials", "https://user:secret@client.example/metadata.json"],
    ["no path", "https://client.example/"],
    ["a file", "file:///etc/passwd"],
    ["no URL at all", "not a url"],
  ])("refuses a URL with %s, without resolving or connecting", async (_case, url) => {
    await expect(fetchMetadataDocument(url)).resolves.toEqual({ ok: false, reason: "url-not-allowed" });

    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([301, 302, 303, 307, 308])("does not follow the redirect of a %i answer", async (status) => {
    answerWith({ status, headers: { location: "https://internal.example/metadata.json" } });

    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toEqual({ ok: false, reason: `status-${status}` });

    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it.each([204, 401, 403, 404, 500])("refuses the status %i", async (status) => {
    answerWith({ status, body: JSON.stringify(DOCUMENT) });

    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toEqual({ ok: false, reason: `status-${status}` });
  });

  it.each([
    ["text/html", { "content-type": "text/html" }],
    ["text/plain", { "content-type": "text/plain; charset=utf-8" }],
    ["a type that only starts like JSON", { "content-type": "application/jsonp" }],
    ["no content type", {}],
  ])("refuses %s, also when the body is JSON", async (_case, headers: Record<string, string>) => {
    answerWith({ headers, body: JSON.stringify(DOCUMENT) });

    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toEqual({ ok: false, reason: "not-json" });
  });

  it("refuses a body that is not JSON", async () => {
    answerWith({ body: "<html>not json</html>" });

    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toEqual({ ok: false, reason: "not-json" });
  });

  it("accepts a body of exactly 10 KB and refuses one byte more", async () => {
    const padding = (bytes: number) => JSON.stringify({ ...DOCUMENT, padding: "" }).length + bytes;
    const bodyOf = (size: number) => JSON.stringify({ ...DOCUMENT, padding: "a".repeat(size - padding(0)) });
    expect(METADATA_MAX_BYTES).toBe(10 * 1024);
    expect(Buffer.byteLength(bodyOf(METADATA_MAX_BYTES))).toBe(METADATA_MAX_BYTES);

    answerWith({ body: bodyOf(METADATA_MAX_BYTES) });
    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toMatchObject({ ok: true });
    answerWith({ body: bodyOf(METADATA_MAX_BYTES + 1) });
    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toEqual({ ok: false, reason: "too-large" });
  });

  it("refuses a body that grows beyond 10 KB over several chunks, and one that announces more", async () => {
    answerWith({ body: Array.from({ length: 11 }, () => Buffer.alloc(1024, "a")) });
    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toEqual({ ok: false, reason: "too-large" });

    answerWith({
      headers: { "content-type": "application/json", "content-length": String(METADATA_MAX_BYTES + 1) },
      body: JSON.stringify(DOCUMENT),
    });
    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toEqual({ ok: false, reason: "too-large" });
  });

  it("reports a connection that fails", async () => {
    mocks.request.mockImplementation(() => {
      const outgoing = new EventEmitter() as EventEmitter & { end: () => void };
      outgoing.end = () => outgoing.emit("error", new Error("connect ECONNREFUSED"));
      return outgoing;
    });

    await expect(fetchMetadataDocument(URL_OF_DOCUMENT)).resolves.toEqual({ ok: false, reason: "request-failed" });
  });

  it("gives up after five seconds when the host does not resolve in time", async () => {
    vi.useFakeTimers();
    mocks.lookup.mockReturnValue(new Promise(() => {}));

    const result = fetchMetadataDocument(URL_OF_DOCUMENT);
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS);

    expect(METADATA_TIMEOUT_MS).toBe(5000);
    await expect(result).resolves.toEqual({ ok: false, reason: "timeout" });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("gives up after five seconds when the server does not answer in time", async () => {
    vi.useFakeTimers();
    // A request that never answers; the signal that the module passed aborts it, as Node does.
    mocks.request.mockImplementation((options: RequestOptions) => {
      const outgoing = new EventEmitter() as EventEmitter & { end: () => void };
      outgoing.end = () => {
        options.signal.addEventListener("abort", () => outgoing.emit("error", new Error("aborted")));
      };
      return outgoing;
    });

    const result = fetchMetadataDocument(URL_OF_DOCUMENT);
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS);

    await expect(result).resolves.toEqual({ ok: false, reason: "timeout" });
  });
});
