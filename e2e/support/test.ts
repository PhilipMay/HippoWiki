import { test as base, type Page } from "@playwright/test";

import { keepFromReloading } from "./hmr";
import { checkRunWorkers, workerCount, workerUrl } from "./workers";

export { expect } from "@playwright/test";

/**
 * How often a page may load itself again while a test waits for it to hydrate. No page of the app reloads itself, and
 * `keepFromReloading()` of ./hmr.ts keeps the hot module replacement of the development server from reloading it, so
 * the check is a guard: it tells a new cause of reloads apart from a failure of the app.
 */
const MAX_RELOADS_WHILE_HYDRATING = 5;

/**
 * Waits until the app has hydrated the page; `HydrationMarker` in the root layout sets the mark. A page that loads
 * itself again more than `MAX_RELOADS_WHILE_HYDRATING` times meanwhile fails the wait at once, with a message that
 * names the reload loop of the development server, instead of waiting until the test times out (see "End-to-end
 * tests" in `spec/testing.md`).
 */
async function waitForHydration(page: Page) {
  const hydrated = page.locator('html[data-hydrated="true"]').waitFor({ state: "attached" });
  // The wait goes on when the loop fails it first, until the page closes at the end of the test.
  hydrated.catch(() => {});
  let reloads = 0;
  let onReload = () => {};
  const looping = new Promise<never>((_, reject) => {
    onReload = () => {
      reloads += 1;
      if (reloads <= MAX_RELOADS_WHILE_HYDRATING) return;
      reject(
        new Error(
          `The page ${page.url()} loaded itself ${reloads} times while the test waited for it to hydrate. No page of ` +
            "the app loads itself again, and the filter of e2e/support/hmr.ts keeps the development server from " +
            'doing so, so this is a new cause of reloads, not a failure of the app; see "End-to-end tests" in ' +
            "spec/testing.md.",
        ),
      );
    };
  });
  page.on("domcontentloaded", onReload);
  try {
    await Promise.race([hydrated, looping]);
  } finally {
    page.off("domcontentloaded", onReload);
  }
}

/**
 * Makes `goto()` and `reload()` of the page wait until the page has hydrated, keeps the development server from
 * reloading it (see ./hmr.ts), and returns the page. `goto()` and `reload()` wait for the route of the hot module
 * replacement before they load the page, so that the first load is covered as well. Before hydration the
 * controls of Client Components are locked, and a change to the DOM can be undone by React or reported as a hydration
 * mismatch. A slow machine such as the CI runner hydrates much later than a fast one, so without the wait a test can
 * pass locally and fail in CI. The `page` of the fixture has it already; a test wraps every other page it opens, e.g.
 * `hydrating(await context.newPage())`. A page with JavaScript disabled never hydrates and must not be wrapped.
 */
export function hydrating(page: Page): Page {
  const routed = keepFromReloading(page);
  // A route that fails fails the next `goto()` or `reload()`, not the test as an unhandled rejection.
  routed.catch(() => {});
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = async (...args) => {
    await routed;
    const response = await goto(...args);
    await waitForHydration(page);
    return response;
  };
  page.reload = async (...args) => {
    await routed;
    const response = await reload(...args);
    await waitForHydration(page);
    return response;
  };
  return page;
}

/**
 * The Playwright `test` for all specs. Its `baseURL` is the address of the server of its worker, so that `page`,
 * `request` and every browser context the test opens use the server and the database of that worker (see
 * ./workers.ts). Its `page` waits after `goto()` and `reload()` until the page has hydrated (see `hydrating()`); with
 * JavaScript disabled there is no wait.
 */
export const test = base.extend({
  // `parallelIndex` counts the workers from 0, the servers are counted from 1. A worker without a server fails, as the
  // global setup does for a run with more workers than servers.
  baseURL: async ({}, provide, testInfo) => {
    const worker = testInfo.parallelIndex + 1;
    checkRunWorkers(worker, workerCount());
    await provide(workerUrl(worker));
  },
  // The fixture callback is called `provide`, not `use`: the React lint rules would take `use` for the React hook.
  page: async ({ page, javaScriptEnabled }, provide) => {
    await provide(javaScriptEnabled === false ? page : hydrating(page));
  },
});
