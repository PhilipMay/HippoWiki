-- Hand-written. Prisma cannot express check constraints, so they are replaced here by hand.

-- The role of an MCP address is Reader, Writer or Manager; Owner is never a role of MCP.
ALTER TABLE "OAuthGrant" DROP CONSTRAINT "OAuthGrant_mcp_role";
ALTER TABLE "OAuthGrant" ADD CONSTRAINT "OAuthGrant_mcp_role" CHECK ("role" IN ('reader', 'writer', 'manager'));
ALTER TABLE "OAuthCode" DROP CONSTRAINT "OAuthCode_mcp_role";
ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_mcp_role" CHECK ("role" IN ('reader', 'writer', 'manager'));
