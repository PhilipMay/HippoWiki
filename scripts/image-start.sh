#!/bin/sh
# The command of the container image (see Containerfile): applies the pending database migrations, then starts the
# server. When the migration fails, the container exits without serving.
set -eu

cd "$(dirname "$0")"

./image-migrate.sh

# The standalone server binds to HOSTNAME. Podman sets that variable to the name of the pod for every container in a
# pod, also when the image or --env sets another value, so it is set here, right before the server starts.
export HOSTNAME=0.0.0.0
# exec, so that the server receives the stop signal of the container.
exec node server.js
