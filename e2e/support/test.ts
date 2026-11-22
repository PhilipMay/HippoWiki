import { test as base } from "@playwright/test";

import { hydrating } from "./hydration";
import { checkRunWorkers, workerCount, workerUrl } from "./workers";

export { expect } from "@playwright/test";
export { hydrating } from "./hydration";

/**
 * The Playwright `test` for all specs. Its `baseURL` is the address of the server of its worker, so that `page`,
 * `request` and every browser context the test opens use the server and the database of that worker (see
 * ./workers.ts). Its `page` waits after `goto()` and `reload()` until the page has hydrated (see `hydrating()` of
 * ./hydration.ts); with JavaScript disabled there is no wait.
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
  // The route of `hydrating()` is in place before the test gets the page: Playwright installs its websocket binding for
  // the whole browser context during the first route of the context, and a page that the test opened meanwhile would
  // miss it and never hydrate.
  page: async ({ page, javaScriptEnabled }, provide) => {
    await provide(javaScriptEnabled === false ? page : await hydrating(page));
  },
});
