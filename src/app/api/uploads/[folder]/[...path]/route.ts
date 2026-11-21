// The upload address of a file, `/api/uploads/<folder>/<name.ext>` and `/api/uploads/<folder>/<tab>/<name.ext>`: the
// body of a `POST` is the file itself, and the query says `strip=0` to keep the metadata of a photo and
// `replace=<lock version>` to store a new version of the file of that name. The route only hands the request and the
// segments of its path to the adapter, which checks the session itself: the address is left out of `src/proxy.ts`,
// which would cut a body after 10 MB.

import { handleUploadRequest } from "@/features/files/http";

type Context = RouteContext<"/api/uploads/[folder]/[...path]">;

/** Stores the body of the request as the file of the address. */
export async function POST(request: Request, context: Context): Promise<Response> {
  return handleUploadRequest(request, await context.params);
}
