// The access to the MCP addresses: the token, the binding of a connection to its address, the role of the user
// behind it, and the use of a grant.
import { KNOWN_ADMIN, KNOWN_USERS } from "../prisma/known-users";
import { NO_STORAGE_STATE } from "./support/auth";
import { createFolder, createFolderRole, createGrant, createPage, createUser, getTestDb } from "./support/database";
import { call, send, setUpProjects } from "./support/mcp";
import { ISSUER } from "./support/oauth";
import { expect, test } from "./support/test";

// An MCP client has no session cookie: it only has the access token of its grant.
test.use({ storageState: NO_STORAGE_STATE });

/**
 * The folder "projects", its Owner, the path of its Reader address, and the access token of a grant of the Owner
 * there: the address and the bearer token of `send()` and `call()` unless a test gives others.
 */
let projects: Awaited<ReturnType<typeof setUpProjects>>["projects"];
let owner: Awaited<ReturnType<typeof setUpProjects>>["owner"];
let address: string;
let secret: string;

test.beforeEach(async () => {
  ({ projects, owner, address, secret } = await setUpProjects());
});

test("without a token /mcp answers 401 with a Bearer challenge and nothing of the wiki", async ({ request }) => {
  await createFolder({ name: "handbook" });

  const response = await send(request, { method: "tools/call", params: { name: "list_folder" } }, null);

  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toMatch(/^Bearer\b/);
  expect(await response.text()).not.toContain("handbook");
});

test("a former API token gets 401 with a Bearer challenge and nothing of the wiki", async ({ request }) => {
  await createFolder({ name: "handbook" });
  // The update deleted every API token; a tool that still sends one sends a value of the former shape.
  const former = `hw_${"A".repeat(43)}`;

  const response = await send(request, { method: "tools/call", params: { name: "list_folder" } }, former);

  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toMatch(/^Bearer\b/);
  expect(response.headers()["www-authenticate"]).toContain("resource_metadata=");
  expect(await response.text()).not.toContain("handbook");
});

for (const [what, token] of [
  ["an access token that the server does not know", `hwa_${"A".repeat(43)}`],
  ["a value that is no token", "not-a-token"],
] as const) {
  test(`with ${what} /mcp answers 401`, async ({ request }) => {
    const response = await send(request, { method: "tools/list" }, token);

    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer\b/);
  });
}

test("with an expired grant, an expired access token and that of a user with the first password a folder address answers 401", async ({
  request,
}) => {
  const folder = projects;
  const expired = await createGrant({ owner, folder, expiresAt: new Date(Date.now() - 1000) });
  const expiredAccess = await createGrant({
    owner,
    folder,
    accessTokenExpiresAt: new Date(Date.now() - 1000),
  });
  const newcomerUser = await createUser({ name: "newcomer" });
  await createFolderRole({ folder, user: newcomerUser, role: "reader" });
  const newcomer = await createGrant({ owner: newcomerUser, folder });

  for (const token of [expired.accessToken, expiredAccess.accessToken, newcomer.accessToken]) {
    const response = await send(request, { method: "tools/list" }, token);

    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer error="invalid_token"/);
  }
});

test("the access token of an admin gets 401 with invalid_token and reaches no tool", async ({ request }) => {
  await createFolder({ name: "handbook" });
  // Admins have no grants; one inserted directly stands for a grant that should not exist.
  const { accessToken: adminToken } = await createGrant({ owner: KNOWN_ADMIN, folder: projects });

  for (const message of [
    { method: "tools/list" },
    { method: "tools/call", params: { name: "list_folder", arguments: {} } },
  ]) {
    const response = await send(request, message, adminToken);

    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer error="invalid_token"/);
    expect(await response.text()).not.toContain("handbook");
  }
  expect((await getTestDb().oAuthGrant.findFirstOrThrow({ where: { userId: KNOWN_ADMIN.id } })).lastUsedAt).toBeNull();
});

test("a bearer token reaches no task of an admin: creating a user leads to the login page and creates nothing", async ({
  request,
}) => {
  for (const response of [
    await request.get("/users?action=create", { headers: { authorization: `Bearer ${secret}` }, maxRedirects: 0 }),
    await request.post("/users?action=create", {
      headers: { authorization: `Bearer ${secret}` },
      form: { name: "jane-doe", type: "admin" },
      maxRedirects: 0,
    }),
    await request.get("/users", { headers: { authorization: `Bearer ${secret}` }, maxRedirects: 0 }),
  ]) {
    // 307 for a read, 303 for a write (`src/proxy.ts`): the bearer token is no login.
    expect([303, 307]).toContain(response.status());
    expect(new URL(response.headers().location ?? "", ISSUER).pathname).toBe("/login");
  }
  expect(await getTestDb().user.findUnique({ where: { username: "jane-doe" } })).toBeNull();
  // The known users and the Owner of "projects".
  expect(await getTestDb().user.count()).toBe(KNOWN_USERS.length + 1);
});

for (const method of ["get", "delete"] as const) {
  test(`${method.toUpperCase()} at a folder address answers 405, with and without a token`, async ({ request }) => {
    const headerSets: Record<string, string>[] = [{}, { authorization: `Bearer ${secret}` }];
    for (const headers of headerSets) {
      const response = await request[method](address, { headers, maxRedirects: 0 });

      expect(response.status()).toBe(405);
      expect(response.headers().allow).toBe("POST");
    }
  });
}

test("a request from a page of another site is refused with 403", async ({ request }) => {
  const response = await request.post(address, {
    headers: { authorization: `Bearer ${secret}`, origin: "https://evil.example" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });

  expect(response.status()).toBe(403);
});

test("/mcp answers 404, also with a valid token; a connected app works at its folder address", async ({ request }) => {
  const plain = await send(request, { method: "tools/list" }, secret, "/mcp");

  expect(plain.status()).toBe(404);
  expect((await send(request, { method: "tools/list" })).status()).toBe(200);
});

test("addresses that are no folder addresses answer 404; a folder address without a token answers 401, whether the folder exists or not", async ({
  request,
}) => {
  for (const to of [`/mcp/${projects.id}/owner`, `/mcp/${projects.id}/Manager`, "/mcp/abc/reader"]) {
    expect((await send(request, { method: "tools/list" }, secret, to)).status(), to).toBe(404);
  }

  const missing = await send(request, { method: "tools/list" }, null, `/mcp/${crypto.randomUUID()}/reader`);
  const existing = await send(request, { method: "tools/list" }, null);
  for (const response of [missing, existing]) {
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer resource_metadata="[^"]+\/reader"$/);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  }
  const manager = await send(request, { method: "tools/list" }, null, `/mcp/${projects.id}/manager`);
  expect(manager.status()).toBe(401);
  expect(manager.headers()["www-authenticate"]).toMatch(/^Bearer resource_metadata="[^"]+\/manager"$/);
});

test("the access token of a connection to /mcp/<A>/reader is refused at /mcp/<A>/writer and at /mcp/<B>/reader", async ({
  request,
}) => {
  const notes = await createFolder({ name: "notes", roles: [{ user: owner, role: "owner" }] });

  for (const to of [`/mcp/${projects.id}/writer`, `/mcp/${notes.id}/reader`]) {
    const response = await send(request, { method: "tools/list" }, secret, to);

    expect(response.status(), to).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer error="invalid_token"/);
  }
});

test("connections to /mcp/<A>/writer, /mcp/<A>/reader and /mcp/<B>/writer work side by side", async ({ request }) => {
  const notes = await createFolder({ name: "notes", roles: [{ user: owner, role: "owner" }] });
  const { client, accessToken: aWriter } = await createGrant({ owner, folder: projects, role: "writer" });
  const { accessToken: aReader } = await createGrant({ owner, folder: projects, client });
  const { accessToken: bWriter } = await createGrant({ owner, folder: notes, role: "writer", client });

  for (const [to, token] of [
    [`/mcp/${projects.id}/writer`, aWriter],
    [`/mcp/${projects.id}/reader`, aReader],
    [`/mcp/${notes.id}/writer`, bWriter],
  ] as const) {
    expect((await send(request, { method: "tools/list" }, token, to)).status(), to).toBe(200);
  }
});

test("after an Owner lowers a Writer to Reader the Writer connection answers 403 and runs no tool, the Reader connection works, and raising the role again restores it", async ({
  request,
}) => {
  const bob = await createUser({ name: "bob", mustChangePassword: false });
  await createFolderRole({ folder: projects, user: bob, role: "writer" });
  await createPage({ folder: projects, name: "plan", content: "# Plan\n\nSecret text" });
  const writer = await createGrant({ owner: bob, folder: projects, role: "writer" });
  const reader = await createGrant({ owner: bob, folder: projects, role: "reader" });
  const where = { folderId_userId: { folderId: projects.id, userId: bob.id } };
  const call = { method: "tools/call", params: { name: "list_folder", arguments: {} } };

  await getTestDb().folderRole.update({ where, data: { role: "reader" } });

  const refused = await send(request, call, writer.accessToken, `/mcp/${projects.id}/writer`);
  expect(refused.status()).toBe(403);
  expect(refused.headers()["www-authenticate"]).toBeUndefined();
  const body = await refused.text();
  expect(body).not.toContain("insufficient_scope");
  expect(body).not.toContain("projects");
  expect(JSON.parse(body)).toEqual({
    error: "role_too_low",
    error_description: "Your role on the folder does not allow this address.",
  });
  expect((await send(request, call, reader.accessToken, `/mcp/${projects.id}/reader`)).status()).toBe(200);

  await getTestDb().folderRole.update({ where, data: { role: "writer" } });

  expect((await send(request, call, writer.accessToken, `/mcp/${projects.id}/writer`)).status()).toBe(200);
  expect(await getTestDb().oAuthGrant.count({ where: { userId: bob.id } })).toBe(2);
});

test("after a Manager is lowered or loses the role the Manager connection answers 403, and works again once the user is Manager again", async ({
  request,
}) => {
  const bob = await createUser({ name: "bob", mustChangePassword: false });
  await createFolderRole({ folder: projects, user: bob, role: "manager" });
  const manager = await createGrant({ owner: bob, folder: projects, role: "manager" });
  const to = `/mcp/${projects.id}/manager`;
  const where = { folderId_userId: { folderId: projects.id, userId: bob.id } };
  const call = { method: "tools/call", params: { name: "list_folder", arguments: {} } };
  const tooLow = {
    error: "role_too_low",
    error_description: "Your role on the folder does not allow this address.",
  };

  expect((await send(request, call, manager.accessToken, to)).status()).toBe(200);
  for (const role of ["writer", "reader"] as const) {
    await getTestDb().folderRole.update({ where, data: { role } });
    const refused = await send(request, call, manager.accessToken, to);
    expect(refused.status(), role).toBe(403);
    expect(await refused.json()).toEqual(tooLow);
  }
  await getTestDb().folderRole.delete({ where });
  const removed = await send(request, call, manager.accessToken, to);
  expect(removed.status()).toBe(403);
  expect(await removed.json()).toEqual(tooLow);

  await createFolderRole({ folder: projects, user: bob, role: "manager" });

  expect((await send(request, call, manager.accessToken, to)).status()).toBe(200);
  expect(await getTestDb().oAuthGrant.count({ where: { userId: bob.id } })).toBe(1);
});

test("after the folder is renamed the connection lists and reads its pages under the new name", async ({ request }) => {
  await createPage({ folder: projects, name: "plan", content: "# Plan" });
  await getTestDb().folder.update({ where: { id: projects.id }, data: { name: "renamed" } });

  const listed = await call(request, "list_folder");
  const read = await call(request, "read_page", { page: "plan" });

  expect(listed.structuredContent).toMatchObject({
    folder: { name: "renamed", address: `${ISSUER}/folders/renamed` },
    pages: [{ name: "plan", address: `${ISSUER}/folders/renamed/plan.md` }],
  });
  expect(read.structuredContent).toMatchObject({ folder: "renamed", title: "Plan" });
});

test("a tool call marks the grant as used", async ({ request }) => {
  const { grant, accessToken: fresh } = await createGrant({ owner, folder: projects });

  expect((await getTestDb().oAuthGrant.findUniqueOrThrow({ where: { id: grant.id } })).lastUsedAt).toBeNull();
  const response = await send(request, { method: "tools/list" }, fresh);

  expect(response.status()).toBe(200);
  expect((await getTestDb().oAuthGrant.findUniqueOrThrow({ where: { id: grant.id } })).lastUsedAt).not.toBeNull();
});

test("the access token of a revoked grant stops working at once", async ({ request }) => {
  const { grant, accessToken: revoked } = await createGrant({ owner, folder: projects });
  expect((await send(request, { method: "tools/list" }, revoked)).status()).toBe(200);

  await getTestDb().oAuthGrant.delete({ where: { id: grant.id } });

  expect((await send(request, { method: "tools/list" }, revoked)).status()).toBe(401);
});
