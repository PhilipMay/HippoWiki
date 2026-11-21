// Runs once when a server of Next.js starts, before it serves (see the instrumentation guide of Next.js): it checks
// whether the files can be kept, and warns the operator when they cannot (`src/features/files/startup.ts`).

import { isNodeRuntime } from "@/lib/env";

export async function register(): Promise<void> {
  // The store lives on the file system, which only the Node.js runtime has.
  if (!isNodeRuntime()) return;
  const { warnIfFilesOff } = await import("@/features/files/startup");
  await warnIfFilesOff();
}
