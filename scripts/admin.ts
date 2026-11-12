// The admin setup: creates the admin account with the password from HIPPOWIKI_ADMIN_PASSWORD if the database of
// DATABASE_URL has no admin yet, and does nothing otherwise. Run it with `npm run admin:setup` in development. In the
// container image it is bundled into one file (`npm run build:admin`) and run by image-admin.sh, so it imports nothing
// that only exists on the development machine, such as dotenv.
//
// Exit codes: 0 when the admin was created or exists already, 1 when it could not be created.
import * as userService from "../src/features/users/service";
import { ADMIN_NAME } from "../src/features/users/schema";
import { getDb } from "../src/lib/db";

const VARIABLE = "HIPPOWIKI_ADMIN_PASSWORD";

/** Runs the admin setup and returns the exit code. */
async function main(): Promise<number> {
  // The one place that reads the variable; the server never does.
  const result = await userService.ensureAdmin(process.env[VARIABLE]);
  if (result.ok) {
    switch (result.value.outcome) {
      case "created":
        console.log(`Admin account "${ADMIN_NAME}" created. Its password must be changed at the first login.`);
        return 0;
      case "exists":
        console.log(`Admin account "${ADMIN_NAME}" exists, nothing to do.`);
        return 0;
    }
  }
  switch (result.error.code) {
    case "password-missing":
      console.error(`${VARIABLE} is not set. It is needed to create the admin account "${ADMIN_NAME}".`);
      return 1;
    case "invalid-input":
      console.error(`${VARIABLE} is not a valid password: ${(result.error.fieldErrors.password ?? []).join(". ")}.`);
      return 1;
    case "busy":
      console.error(`The admin account "${ADMIN_NAME}" was not created: too many password hashes are running.`);
      return 1;
    case "failed":
      console.error(`The admin account "${ADMIN_NAME}" could not be created; the error is logged above.`);
      return 1;
  }
}

async function run(): Promise<number> {
  try {
    return await main();
  } finally {
    await getDb().$disconnect();
  }
}

run().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    // E.g. a missing or malformed DATABASE_URL, which fails before the service can log.
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
