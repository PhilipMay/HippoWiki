// What only the forms of connected apps need. No server-only imports, so Client Components can use it.

/** State of the "Revoke app" form: why the app could not be revoked. */
export type RevokeAppFormState = { message?: string };

/** The Server Action behind the "Revoke app" form; it returns the error to show, or redirects on success. */
export type RevokeAppFormAction = (prevState: RevokeAppFormState, formData: FormData) => Promise<RevokeAppFormState>;
