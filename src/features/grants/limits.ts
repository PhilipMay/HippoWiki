// The limit of connected apps per user. A pure module without imports, so that the services of OAuth, which enforce
// it, and the consent page, which names it, share it.

/**
 * How many grants a user may hold, expired ones included. A user holds one grant per app and MCP address, so per
 * folder and role.
 */
export const MAX_GRANTS_PER_USER = 50;
