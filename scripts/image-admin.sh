#!/bin/sh
# Creates the admin account in the database of DATABASE_URL, with the password from HIPPOWIKI_ADMIN_PASSWORD, if there
# is none yet; otherwise it does nothing and ignores the variable. It exits with the exit code of the admin setup: 0
# when the admin was created or exists, 1 when it could not be created, e.g. because the variable is missing or not a
# valid password. Part of the container image (see Containerfile): image-start.sh runs it on every start after the
# migration, and it is the command for the admin setup as a step of its own, after the migration, because the tables
# must exist: podman run --rm --env DATABASE_URL=... --env HIPPOWIKI_ADMIN_PASSWORD=... <image> ./image-admin.sh
# In a running container: podman exec <container> ./image-admin.sh
set -eu

cd "$(dirname "$0")"
exec node admin.mjs
