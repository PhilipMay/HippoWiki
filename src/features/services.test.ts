import { expect, it, vi } from "vitest";

// A service works outside a request and for callers other than the GUI, so it must load without Next.js and React.
// The factories throw as soon as one of these modules is imported, also indirectly through `schema.ts` or `src/lib/`.
// Lint only sees the imports of `service.ts` itself.
vi.mock("next/cache", () => {
  throw new Error("a service must not import next/cache");
});
vi.mock("next/headers", () => {
  throw new Error("a service must not import next/headers");
});
vi.mock("next/navigation", () => {
  throw new Error("a service must not import next/navigation");
});
vi.mock("next/server", () => {
  throw new Error("a service must not import next/server");
});
vi.mock("react", () => {
  throw new Error("a service must not import react");
});

it("the services load without Next.js and React", async () => {
  const folderService = await import("@/features/folders/service");
  const pageService = await import("@/features/pages/service");
  const userService = await import("@/features/users/service");
  const tokenService = await import("@/features/tokens/service");
  // The auth service loads Better Auth with its `nextCookies()` plugin, which must not need Next.js to be loaded.
  const authService = await import("@/features/auth/service");

  expect(folderService.listFolders).toBeTypeOf("function");
  expect(pageService.listFolderPages).toBeTypeOf("function");
  expect(userService.ensureAdmin).toBeTypeOf("function");
  expect(tokenService.createToken).toBeTypeOf("function");
  expect(authService.logIn).toBeTypeOf("function");
});
