// Runs once when a server of Next.js starts, before it serves (see the instrumentation guide of Next.js): it checks
// whether the files can be kept, and warns the operator when they cannot (`src/features/files/startup.ts`).

export async function register(): Promise<void> {
  // The store lives on the file system, which only the Node.js runtime has. The check compares `NEXT_RUNTIME` here,
  // not in a helper, so that Next.js can see it when it bundles the code and leaves the store out of the Edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warnIfFilesOff } = await import("@/features/files/startup");
    await warnIfFilesOff();
  }
}
