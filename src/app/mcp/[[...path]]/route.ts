// The MCP addresses of the folders, `/mcp/<folder-uuid>/<reader|writer|manager>`: AI apps work with one folder here,
// with the access token of a grant to an OAuth client as a bearer token. The route only hands the request and the
// segments of its path to the adapter, which answers every other path below `/mcp` and `/mcp` itself with 404, checks
// the token itself and answers 404 while `HIPPOWIKI_PUBLIC_URL` is not set; `src/proxy.ts` lets `/mcp` and every
// address below it pass without a session cookie.

import { handleMcpRequest } from "@/features/mcp/http";

type Context = RouteContext<"/mcp/[[...path]]">;

/** Hands the request and the segments of its path after `/mcp` to the adapter. */
async function handle(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  return handleMcpRequest(request, path);
}

/** Every MCP message is a `POST`. */
export function POST(request: Request, context: Context): Promise<Response> {
  return handle(request, context);
}

/** There is no stream to open: the adapter answers 405, or 404 for a path that is no MCP address. */
export function GET(request: Request, context: Context): Promise<Response> {
  return handle(request, context);
}

/** There is no session to end: the adapter answers 405, or 404 for a path that is no MCP address. */
export function DELETE(request: Request, context: Context): Promise<Response> {
  return handle(request, context);
}
