import { expect, it, vi } from "vitest";

// A service works outside a request and for callers other than the GUI, so it must load without Next.js and React.
// The factories throw as soon as one of these modules is imported, also indirectly through `schema.ts` or `src/lib/`.
// Lint only sees the imports of a service module itself.
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
  const historyService = await import("@/features/pages/history-service");
  const linksService = await import("@/features/pages/links-service");
  const searchService = await import("@/features/search/service");
  const folderRoleService = await import("@/features/folder-roles/service");
  // The actors and the guards of a content write, which every content service and adapter imports.
  const actors = await import("@/features/folder-roles/actors");
  const userService = await import("@/features/users/service");
  const grantService = await import("@/features/grants/service");
  // The auth service loads Better Auth with its `nextCookies()` plugin, which must not need Next.js to be loaded.
  const authService = await import("@/features/auth/service");
  // The service modules of OAuth, one per part of the code flow.
  const oauthClientsService = await import("@/features/oauth/clients-service");
  const oauthAuthorizationService = await import("@/features/oauth/authorization-service");
  const oauthTokenService = await import("@/features/oauth/token-service");
  const oauthCleanupService = await import("@/features/oauth/cleanup-service");
  // The MCP server, its tools and their schemas call the services and load wherever they load.
  const mcpServer = await import("@/features/mcp/server");
  const mcpTools = await import("@/features/mcp/tools");
  const mcpToolSchemas = await import("@/features/mcp/tool-schemas");

  expect(folderService.listFolders).toBeTypeOf("function");
  expect(pageService.listFolderPages).toBeTypeOf("function");
  expect(historyService.listPageRevisions).toBeTypeOf("function");
  expect(linksService.listLinkingPages).toBeTypeOf("function");
  expect(searchService.indexOutdatedPages).toBeTypeOf("function");
  expect(searchService.searchPages).toBeTypeOf("function");
  expect(folderRoleService.folderRoleOf).toBeTypeOf("function");
  expect(actors.openContentWrite).toBeTypeOf("function");
  expect(userService.ensureAdmin).toBeTypeOf("function");
  expect(grantService.listGrants).toBeTypeOf("function");
  expect(authService.logIn).toBeTypeOf("function");
  expect(oauthClientsService.registerClient).toBeTypeOf("function");
  expect(oauthAuthorizationService.createCode).toBeTypeOf("function");
  expect(oauthTokenService.exchangeCode).toBeTypeOf("function");
  expect(oauthCleanupService.deleteStaleRows).toBeTypeOf("function");
  expect(mcpServer.createWikiServer).toBeTypeOf("function");
  expect(mcpTools.listFolder).toBeTypeOf("function");
  expect(mcpToolSchemas.readPageInput).toBeDefined();
});
