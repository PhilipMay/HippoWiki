// What the folder view "AI apps" reads: the MCP addresses of a folder that the logged-in user may connect an AI app
// to. The folder and the user's role on it come from the folder query of the route, which has checked the login.

import { mcpRolesFor, type McpRole, type Role } from "@/features/folder-roles/roles";
import { isOAuthOn, mcpResourceOf } from "@/features/oauth/issuer";

/** An MCP address of a folder as the view "AI apps" shows it: the full address and its role. */
export type McpAddressEntry = { role: McpRole; address: string };

/**
 * The full MCP addresses of the folder for the roles the user's role allows (`mcpRolesFor()`): the Reader address for
 * a Reader, the Reader and the Writer address for a Writer, the Reader, the Writer and the Manager address for a
 * Manager and an Owner, none without a role. `null` without
 * `HIPPOWIKI_PUBLIC_URL`, when there is no MCP server: then the view does not exist.
 */
export function listMcpAddresses(folder: { id: string }, role: Role | null): McpAddressEntry[] | null {
  if (!isOAuthOn()) return null;
  return mcpRolesFor(role).flatMap((mcpRole) => {
    // The full address that a client sends as its `resource`, as OAuth writes it.
    const address = mcpResourceOf({ folderId: folder.id, role: mcpRole });
    return address === null ? [] : [{ role: mcpRole, address }];
  });
}
