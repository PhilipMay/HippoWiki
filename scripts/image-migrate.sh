#!/bin/sh
# Applies the pending database migrations to the database of DATABASE_URL and exits with the exit code of Prisma.
# Part of the container image (see Containerfile): image-start.sh runs it on every start, and it is the command for
# applying the migrations as a step of its own: podman run --rm --env DATABASE_URL=... <image> ./image-migrate.sh
set -eu

cd "$(dirname "$0")/migrate"
exec ./node_modules/.bin/prisma migrate deploy
