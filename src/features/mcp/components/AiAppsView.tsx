import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import FolderBreadcrumbs from "@/features/folders/components/FolderBreadcrumbs";
import { MCP_ROLE_ABILITIES, ROLE_LABELS } from "@/features/folder-roles/roles";
import McpAddress from "@/features/mcp/components/McpAddress";
import type { McpAddressEntry } from "@/features/mcp/queries";
import SearchField from "@/features/search/components/SearchField";

type AiAppsViewProps = {
  folderName: string;
  /** The MCP addresses of the folder that the role of the user allows, from `listMcpAddresses()`. */
  addresses: McpAddressEntry[];
};

/** The folder view "AI apps": the MCP addresses of the folder that the user may connect an AI app to, each to copy. */
export default function AiAppsView({ folderName, addresses }: AiAppsViewProps) {
  return (
    <Stack spacing={3}>
      <SearchField folderName={folderName} />
      <FolderBreadcrumbs folderName={folderName} current="AI apps" />
      <Typography variant="h4" component="h1">
        AI apps
      </Typography>
      <Typography>
        Copy an address into an AI app to connect it to this folder through MCP. The app asks you to approve the
        connection. It works only on this folder and never with more than your own role on it.
      </Typography>
      {addresses.map(({ role, address }) => (
        <Stack key={role} component="section" spacing={1} aria-labelledby={`mcp-${role}`}>
          <Typography id={`mcp-${role}`} variant="h6" component="h2">
            {ROLE_LABELS[role]}
          </Typography>
          <Typography color="text.secondary">{MCP_ROLE_ABILITIES[role]}</Typography>
          <McpAddress address={address} label={`${ROLE_LABELS[role]} address`} />
        </Stack>
      ))}
    </Stack>
  );
}
