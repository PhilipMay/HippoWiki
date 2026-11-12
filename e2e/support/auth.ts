// The logins that the end-to-end tests share. The setup project (e2e/auth.setup.ts) logs in once as each known user
// and saves the browser state and the rows of the sessions here; the tests start with a saved state instead of
// logging in again, and `resetTestDatabase()` puts the session rows back after it has emptied the tables.
import { fileURLToPath } from "node:url";

/** The directory of the saved logins; ignored by Git and removed before every run. */
export const AUTH_DIRECTORY = fileURLToPath(new URL("../.auth/", import.meta.url));

/** The browser state of the known normal user; the `chromium` project uses it for every test. */
export const USER_STORAGE_STATE = `${AUTH_DIRECTORY}user.json`;

/** The browser state of the known admin; a spec that needs the admin sets it with `test.use()`. */
export const ADMIN_STORAGE_STATE = `${AUTH_DIRECTORY}admin.json`;

/** The rows of the sessions behind the two browser states, as JSON. */
export const SESSIONS_FILE = `${AUTH_DIRECTORY}sessions.json`;

/** The browser state of a visitor who is not logged in; a spec that needs no user sets it with `test.use()`. */
export const NO_STORAGE_STATE = { cookies: [], origins: [] };
