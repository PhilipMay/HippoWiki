import { test as base, type Page } from "@playwright/test";

import { workerUrl } from "./workers";

export { expect } from "@playwright/test";

/** Waits until the app has hydrated the page; `HydrationMarker` in the root layout sets the mark. */
async function waitForHydration(page: Page) {
  await page.locator('html[data-hydrated="true"]').waitFor({ state: "attached" });
}

/**
 * Makes `goto()` and `reload()` of the page wait until the page has hydrated, and returns the page. Before then the
 * controls of Client Components are locked, and a change to the DOM can be undone by React or reported as a hydration
 * mismatch. A slow machine such as the CI runner hydrates much later than a fast one, so without the wait a test can
 * pass locally and fail in CI. The `page` of the fixture has it already; a test wraps every other page it opens, e.g.
 * `hydrating(await context.newPage())`. A page with JavaScript disabled never hydrates and must not be wrapped.
 */
export function hydrating(page: Page): Page {
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = async (...args) => {
    const response = await goto(...args);
    await waitForHydration(page);
    return response;
  };
  page.reload = async (...args) => {
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
  // `parallelIndex` counts the workers from 0, the servers are counted from 1.
  baseURL: async ({}, provide, testInfo) => {
    await provide(workerUrl(testInfo.parallelIndex + 1));
  },
  // The fixture callback is called `provide`, not `use`: the React lint rules would take `use` for the React hook.
  page: async ({ page, javaScriptEnabled }, provide) => {
    await provide(javaScriptEnabled === false ? page : hydrating(page));
  },
});
