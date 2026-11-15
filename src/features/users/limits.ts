// Length limits of user names and passwords. A module of its own, so that Client Components can show them without
// importing `schema.ts`, which would put the list of common passwords into the bundle for the browser.

export const USER_NAME_MIN_LENGTH = 3;
export const USER_NAME_MAX_LENGTH = 30;

export const PASSWORD_MIN_LENGTH = 8;
/** The upper limit protects the password hashing from very long inputs. */
export const PASSWORD_MAX_LENGTH = 128;
