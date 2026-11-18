import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import FolderView from "@/features/folders/components/FolderView";
import { folderAddressOf } from "@/features/folders/folder-query";
import { getFolderByName } from "@/features/folders/queries";
import FolderRolesView from "@/features/folder-roles/components/FolderRolesView";
import AiAppsView from "@/features/mcp/components/AiAppsView";
import { listMcpAddresses } from "@/features/mcp/queries";
import AllPagesView from "@/features/pages/components/AllPagesView";
import NewPageView from "@/features/pages/components/NewPageView";
import { pageTitle } from "@/lib/site";

type Props = PageProps<"/folders/[folder]">;

/**
 * What the address shows: the folder with its action or view and the browser title, or `null` for the not-found page
 * (see `folderAddressOf()`). The title and the page both use it. `mcpAddresses` is `null` without a public URL, when
 * there is no MCP server: no view and no button.
 */
async function resolve({ params, searchParams }: Props) {
  const folder = await getFolderByName((await params).folder);
  if (!folder) return null;
  const mcpAddresses = listMcpAddresses(folder, folder.role);
  const address = folderAddressOf(folder, await searchParams, mcpAddresses !== null);
  return address && { folder, mcpAddresses, ...address };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { title: pageTitle((await resolve(props))?.title) };
}

export default async function FolderPage(props: Props) {
  // Nothing is shown without a login. First, so that an invalid address also leads to the login page.
  const user = await requireUser();

  // An action that the role does not include answers like an unknown one, before the content is read.
  const { folder, mcpAddresses, action, view } = (await resolve(props)) ?? notFound();

  if (action === "new") return <NewPageView folder={folder} tab={null} />;
  switch (view) {
    case "all":
      return <AllPagesView folder={folder} />;
    case "roles":
      return <FolderRolesView folder={folder} userId={user.id} />;
    case "mcp":
      // `resolve()` finds the view only with an MCP server.
      return <AiAppsView folderName={folder.name} addresses={mcpAddresses ?? notFound()} />;
    case null:
      return <FolderView folder={folder} action={action} hasMcp={mcpAddresses !== null} />;
  }
}
