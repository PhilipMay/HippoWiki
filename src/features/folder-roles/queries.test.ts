import { beforeEach, expect, it, vi } from "vitest";

import { listAllFolderRoles, listFolderRoles, listRoleCandidates } from "@/features/folder-roles/queries";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  requireUser: vi.fn(),
  listFolderRoles: vi.fn(),
  listRoleCandidates: vi.fn(),
  listAllFolderRoles: vi.fn(),
}));

vi.mock("@/features/folder-roles/service", () => ({
  listFolderRoles: mocks.listFolderRoles,
  listRoleCandidates: mocks.listRoleCandidates,
  listAllFolderRoles: mocks.listAllFolderRoles,
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));

/** The logged-in user that the mocked `requireUser()` returns: the actor of the service read. */
const USER = { id: "7c0b6a2e-3f5d-4c1a-9e2b-1a4f8d6c1002", name: "alice", type: "user", mustChangePassword: false };
const FOLDER_ID = "0b0e7a52-6a4f-4a3e-9d0b-0c1f4f1f7a10";

/** Thrown by the mocked `requireUser()`, like the redirect to the login page that the real one throws. */
class RedirectError extends Error {}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
});

it("waits for connection() and requireUser(), then reads the roles as the logged-in user", async () => {
  let release = () => {};
  mocks.connection.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
  const roles = [{ user: { id: USER.id, name: "alice" }, role: "owner" }];
  mocks.listFolderRoles.mockResolvedValue(roles);

  const result = listFolderRoles(FOLDER_ID);
  await new Promise((resolve) => setImmediate(resolve));
  expect(mocks.requireUser).not.toHaveBeenCalled();
  expect(mocks.listFolderRoles).not.toHaveBeenCalled();

  release();
  await expect(result).resolves.toBe(roles);
  expect(mocks.listFolderRoles).toHaveBeenCalledExactlyOnceWith(USER, FOLDER_ID);
});

it("reads nothing without a login", async () => {
  mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

  await expect(listFolderRoles(FOLDER_ID)).rejects.toBeInstanceOf(RedirectError);
  expect(mocks.listFolderRoles).not.toHaveBeenCalled();
});

it("passes on the null of the service", async () => {
  mocks.listFolderRoles.mockResolvedValue(null);

  await expect(listFolderRoles(FOLDER_ID)).resolves.toBeNull();
});

it("reads the candidates and the overview as the logged-in user, after connection()", async () => {
  mocks.listRoleCandidates.mockResolvedValue([]);
  mocks.listAllFolderRoles.mockResolvedValue(null);

  await expect(listRoleCandidates(FOLDER_ID)).resolves.toEqual([]);
  await expect(listAllFolderRoles()).resolves.toBeNull();

  expect(mocks.connection).toHaveBeenCalledTimes(2);
  expect(mocks.listRoleCandidates).toHaveBeenCalledExactlyOnceWith(USER, FOLDER_ID);
  expect(mocks.listAllFolderRoles).toHaveBeenCalledExactlyOnceWith(USER);
});

it("reads neither the candidates nor the overview without a login", async () => {
  mocks.requireUser.mockRejectedValue(new RedirectError("/login"));

  await expect(listRoleCandidates(FOLDER_ID)).rejects.toBeInstanceOf(RedirectError);
  await expect(listAllFolderRoles()).rejects.toBeInstanceOf(RedirectError);
  expect(mocks.listRoleCandidates).not.toHaveBeenCalled();
  expect(mocks.listAllFolderRoles).not.toHaveBeenCalled();
});
