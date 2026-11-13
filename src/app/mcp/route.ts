// The MCP endpoint: AI assistants read the wiki here, with an API token as a bearer token. The route only hands the
// request to the adapter, which checks the token itself; `src/proxy.ts` lets `/mcp` pass without a session cookie.

import { handleMcpRequest } from "@/features/mcp/http";

/** Every MCP message is a `POST`. */
export function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

/** There is no stream to open: the adapter answers 405. */
export function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

/** There is no session to end: the adapter answers 405. */
export function DELETE(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}
