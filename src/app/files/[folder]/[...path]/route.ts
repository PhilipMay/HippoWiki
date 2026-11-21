// The address of a file itself, `/files/<folder>/<name.ext>` and `/files/<folder>/<tab>/<name.ext>`: it sends the
// content of the file to a logged-in user with a role on its folder, with `?version=<n>` an earlier version and with
// `?download` as an attachment. The route only hands the request and the segments of its path to the adapter, which
// answers everything else with the not-found page; `src/proxy.ts` sends a request without a session cookie to the login
// page first. The headers that run nothing in a file are set in `next.config.ts`.

import { handleFileRequest } from "@/features/files/http";

type Context = RouteContext<"/files/[folder]/[...path]">;

/** Sends the content of the file. */
export async function GET(request: Request, context: Context): Promise<Response> {
  return handleFileRequest(request, await context.params);
}

/** Sends the headers of the content of the file, without the content. */
export async function HEAD(request: Request, context: Context): Promise<Response> {
  return handleFileRequest(request, await context.params);
}
