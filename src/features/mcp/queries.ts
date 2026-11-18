// What the folder view "AI apps" reads: the MCP addresses of a folder that the logged-in user may connect an AI app
// to. The folder and the user's role on it come from the folder query of the route, which has checked the login.

import { mcpRolesFor, type McpRole, type Role } from "@/features/folder-roles/roles";
import { mcpFolderPath } from "@/lib/addresses";
import { getServerEnv } from "@/lib/env";

/** An MCP address of a folder as the view "AI apps" shows it: the full address and its role. */
type McpAddressEntry = { role: McpRole; address: string };

/**
 * The full MCP addresses of the folder for the roles the user's role allows (`mcpRolesFor()`): the Reader address for
 * a Reader, the Reader and the Writer address for a Writer, the Reader, the Writer and the Manager address for a
 * Manager and an Owner, none without a role. `null` without
 * `HIPPOWIKI_PUBLIC_URL`, when there is no MCP server: then the view does not exist.
 */
export function listMcpAddresses(folder: { id: string }, role: Role | null): McpAddressEntry[] | null {
  const publicUrl = getServerEnv().HIPPOWIKI_PUBLIC_URL;
  if (publicUrl === undefined) return null;
  return mcpRolesFor(role).map((mcpRole) => ({
    role: mcpRole,
    address: `${publicUrl}${mcpFolderPath(folder.id, mcpRole)}`,
  }));
}
