#!/bin/sh
# The command of the container image (see Containerfile): applies the pending database migrations, creates the admin
# account if there is none, then starts the server. When the migration or the admin setup fails, the container exits
# with a non-zero code without serving. There is no switch to skip the migration, and the script does not wait for the
# database: when it is not reachable, the migration fails and the container exits. Two containers that start together
# both try to create the admin; the second finds it created and counts that as done (`ensureAdmin()`).
set -eu

cd "$(dirname "$0")"

./image-migrate.sh
./image-admin.sh

# The standalone server binds to HOSTNAME. Podman sets that variable to the name of the pod for every container in a
# pod, also when the image or --env sets another value, so it is set here, right before the server starts.
export HOSTNAME=0.0.0.0
# exec, so that the server receives the stop signal of the container.
exec node server.js
