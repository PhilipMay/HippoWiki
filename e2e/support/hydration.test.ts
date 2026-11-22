import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { hydrating } from "./hydration";

/** A promise with the functions that settle it, so that the test decides when the route is in place. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Whether the promise has settled once the queued callbacks have run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
}

/** A fake page whose `routeWebSocket()` settles with the returned `route`, and which records the calls in order. */
function fakePage() {
  const route = deferred<void>();
  const calls: string[] = [];
  const response = { status: 200 };
  const page = {
    routeWebSocket: vi.fn(() => route.promise),
    goto: vi.fn(async (url: string) => {
      calls.push(`goto ${url}`);
      return response;
    }),
    reload: vi.fn(async () => {
      calls.push("reload");
      return response;
    }),
    locator: vi.fn((selector: string) => ({
      waitFor: vi.fn(async () => {
        calls.push(`wait ${selector}`);
      }),
    })),
    on: vi.fn(),
    off: vi.fn(),
    url: () => "http://localhost:3101/folders",
  };
  return { page: page as unknown as Page, fake: page, route, calls, response };
}

describe("hydrating", () => {
  it("settles only once the route is in place, with the same page", async () => {
    const { page, fake, route } = fakePage();

    const wrapped = hydrating(page);

    expect(fake.routeWebSocket).toHaveBeenCalledOnce();
    expect(await settled(wrapped)).toBe(false);
    route.resolve();
    await expect(wrapped).resolves.toBe(page);
  });

  it("rejects when the route fails", async () => {
    const { page, route } = fakePage();
    const failure = new Error("route failed");

    const wrapped = hydrating(page);
    route.reject(failure);

    await expect(wrapped).rejects.toBe(failure);
  });

  it("makes goto() call the original goto() and then wait for the page to hydrate", async () => {
    const { page, fake, route, calls, response } = fakePage();
    const original = fake.goto;
    route.resolve();
    const wrapped = await hydrating(page);

    await expect(wrapped.goto("/folders")).resolves.toBe(response);

    expect(original).toHaveBeenCalledWith("/folders");
    expect(calls).toStrictEqual(["goto /folders", 'wait html[data-hydrated="true"]']);
  });
});
