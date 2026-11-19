#!/bin/sh
# Makes the pages of the database of DATABASE_URL searchable: derives the search text and the language of every page
# that was stored before search, or by an older version of the derivation, and does nothing when there is none. It
# exits with the exit code of the search index: 0 when every page is derived, 1 when the pages could not be derived.
# Part of the container image (see Containerfile): image-start.sh runs it on every start after the migration and the
# admin setup, before the server serves, so that the first search finds every page; the first start after the update
# of search, and after an update that changes the derivation, takes longer once. It is also the command for the index
# as a step of its own, after the migration: podman run --rm --env DATABASE_URL=... <image> ./image-search-index.sh
# In a running container: podman exec <container> ./image-search-index.sh
set -eu

cd "$(dirname "$0")"
exec node search-index.mjs
