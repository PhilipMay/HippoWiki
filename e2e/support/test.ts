import { test as base, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

/** Waits until the app has hydrated the page; `HydrationMarker` in the root layout sets the mark. */
async function waitForHydration(page: Page) {
  await page.locator('html[data-hydrated="true"]').waitFor({ state: "attached" });
}

/**
 * The Playwright `test` for all specs. After `page.goto()` and `page.reload()` it waits until the page has hydrated:
 * before then the controls of Client Components are locked, and a change to the DOM can be undone by React or reported
 * as a hydration mismatch. A slow machine such as the CI runner hydrates much later than a fast one, so without the wait
 * a test can pass locally and fail in CI. With JavaScript disabled the page never hydrates, so there is no wait.
 */
export const test = base.extend({
  // The fixture callback is called `provide`, not `use`: the React lint rules would take `use` for the React hook.
  page: async ({ page, javaScriptEnabled }, provide) => {
    if (javaScriptEnabled !== false) {
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
    }
    await provide(page);
  },
});
