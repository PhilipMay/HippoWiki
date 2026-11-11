import { redirect } from "next/navigation";

import { foldersPath } from "@/lib/addresses";

/** The home page is the list of folders. */
export default function Home() {
  redirect(foldersPath());
}
