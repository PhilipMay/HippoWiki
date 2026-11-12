#!/usr/bin/env bash
# Builds the container image of HippoWiki with Podman (see Containerfile) and checks it.
# Usage: scripts/image.sh <build|smoke|check-tag|reference> [args...]
#   build   builds the image as hippowiki:local for the platform of this machine. IMAGE_VERSION and IMAGE_REVISION,
#           when set, become the labels org.opencontainers.image.version and org.opencontainers.image.revision.
#   smoke   runs the image of `build` against a throwaway, empty database and checks that it installs itself and
#           serves the wiki. It removes everything it started, also when a check fails.
#   check-tag <tag>          succeeds when <tag> is a valid image tag other than `latest`
#   reference <owner> <tag>  checks <tag> and prints ghcr.io/<owner in lower case>/hippowiki:<tag>
# The release workflow (.github/workflows/container_image.yml) calls all four commands.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="hippowiki:local"

# The smoke test runs in a pod of its own. Its names and its port differ from the development database (hippowiki-db,
# 5432), the test database (hippowiki-test-db, 5433), `npm run dev` (3000) and the end-to-end server (3100), so it can
# run next to them. Only the port of the application is published; the database port stays inside the pod.
SMOKE_POD="hippowiki-smoke"
SMOKE_DB="hippowiki-smoke-db"
SMOKE_APP="hippowiki-smoke-app"
SMOKE_MIGRATE="hippowiki-smoke-migrate"
SMOKE_URL="http://127.0.0.1:3200"
SMOKE_DB_NAME="hippowiki_smoke"
SMOKE_DB_USER="hippowiki_smoke"
SMOKE_DB_PASSWORD="hippowiki_smoke"
SMOKE_DATABASE_URL="postgresql://${SMOKE_DB_USER}:${SMOKE_DB_PASSWORD}@127.0.0.1:5432/${SMOKE_DB_NAME}"
READY_TIMEOUT_SECONDS=60

usage() {
  echo "Usage: $0 <build|smoke|check-tag <tag>|reference <owner> <tag>>" >&2
  exit 1
}

require_podman() {
  if ! podman info >/dev/null 2>&1; then
    echo "Podman is not reachable. Start the Podman machine with: podman machine start" >&2
    exit 1
  fi
}

# Fails when the Node.js major version of .nvmrc and the one of the Node.js image in the Containerfile differ.
check_node_version() {
  local nvmrc_major image image_major
  nvmrc_major="$(tr -d '[:space:]' <.nvmrc)"
  nvmrc_major="${nvmrc_major#v}"
  nvmrc_major="${nvmrc_major%%.*}"
  # The first FROM line is the base stage, the only one that names the Node.js image.
  image="$(awk '$1 == "FROM" { print $2; exit }' Containerfile)"
  image_major="$(sed -n -E 's#^.*/node:([0-9]+)([.-].*)?$#\1#p' <<<"$image")"
  if [[ -z "$image_major" ]]; then
    echo "No Node.js image found in the first FROM line of Containerfile (found: ${image:-nothing})." >&2
    exit 1
  fi
  if [[ "$nvmrc_major" != "$image_major" ]]; then
    echo "Node.js major version differs: .nvmrc has ${nvmrc_major}, the Containerfile uses ${image}." >&2
    echo "Change both together." >&2
    exit 1
  fi
}

cmd_build() {
  check_node_version
  local args=(--file Containerfile --tag "$IMAGE")
  if [[ -n "${IMAGE_VERSION:-}" ]]; then
    args+=(--label "org.opencontainers.image.version=${IMAGE_VERSION}")
  fi
  if [[ -n "${IMAGE_REVISION:-}" ]]; then
    args+=(--label "org.opencontainers.image.revision=${IMAGE_REVISION}")
  fi
  echo "Building ${IMAGE}..."
  podman build "${args[@]}" .
  echo "Built ${IMAGE}."
}

smoke_fail() {
  echo "Smoke test failed: $*" >&2
  exit 1
}

# Runs on every exit of the smoke test. On a failure it prints the last log lines of the containers first.
smoke_cleanup() {
  local status=$?
  if ((status != 0)); then
    local container
    for container in "$SMOKE_DB" "$SMOKE_APP"; do
      if podman container exists "$container"; then
        echo "--- Last log lines of ${container}:" >&2
        podman logs --tail 30 "$container" >&2 || true
      fi
    done
  fi
  podman pod rm --force --ignore "$SMOKE_POD" >/dev/null 2>&1 || true
  exit "$status"
}

# Prints the HTTP status code of a URL, or 000 when nothing answers.
http_status() {
  curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "$1" || true
}

smoke_start_db() {
  local pg_image
  # The image is pinned in scripts/Containerfile, like for the development and the test database.
  pg_image="$(awk '$1 == "FROM" { print $2; exit }' scripts/Containerfile)"
  if [[ -z "$pg_image" ]]; then
    echo "No FROM line with the PostgreSQL image found in scripts/Containerfile." >&2
    exit 1
  fi
  echo "Starting PostgreSQL (${pg_image}) with an empty database..."
  podman run --detach \
    --pod "$SMOKE_POD" \
    --name "$SMOKE_DB" \
    --env POSTGRES_DB="$SMOKE_DB_NAME" \
    --env POSTGRES_USER="$SMOKE_DB_USER" \
    --env POSTGRES_PASSWORD="$SMOKE_DB_PASSWORD" \
    --tmpfs /var/lib/postgresql \
    "$pg_image" \
    -c fsync=off \
    -c synchronous_commit=off >/dev/null
  # Checks over TCP: while the image initializes the database, its temporary server only listens on the Unix socket
  # and must not count as ready.
  local waited=0
  until podman exec "$SMOKE_DB" pg_isready -q -h 127.0.0.1 -U "$SMOKE_DB_USER" -d "$SMOKE_DB_NAME" 2>/dev/null; do
    if ((waited >= READY_TIMEOUT_SECONDS)); then
      smoke_fail "the database did not become ready within ${READY_TIMEOUT_SECONDS}s."
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

# Starts a container of the image against the database and waits until /api/health reports ok.
smoke_start_app() {
  echo "Starting ${IMAGE}..."
  podman run --detach \
    --pod "$SMOKE_POD" \
    --name "$SMOKE_APP" \
    --env DATABASE_URL="$SMOKE_DATABASE_URL" \
    "$IMAGE" >/dev/null
  local waited=0
  until [[ "$(curl --silent --max-time 5 "${SMOKE_URL}/api/health" || true)" == '{"status":"ok"}' ]]; do
    if [[ "$(podman container inspect --format '{{.State.Running}}' "$SMOKE_APP")" != "true" ]]; then
      smoke_fail "${SMOKE_APP} exited with code $(podman container inspect --format '{{.State.ExitCode}}' "$SMOKE_APP") instead of serving."
    fi
    if ((waited >= READY_TIMEOUT_SECONDS)); then
      smoke_fail "/api/health did not report ok within ${READY_TIMEOUT_SECONDS}s."
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "ok: /api/health reports ok"
}

smoke_require_status() {
  local path="$1" status
  status="$(http_status "${SMOKE_URL}${path}")"
  if [[ "$status" != "200" ]]; then
    smoke_fail "${path} answered ${status} instead of 200."
  fi
  echo "ok: ${path} answers 200"
}

smoke_migrations() {
  podman exec "$SMOKE_DB" psql -At -U "$SMOKE_DB_USER" -d "$SMOKE_DB_NAME" \
    -c "SELECT id, migration_name, checksum, started_at, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name"
}

cmd_smoke() {
  if ! podman image exists "$IMAGE"; then
    echo "Image ${IMAGE} not found. Build it first with: npm run image:build" >&2
    exit 1
  fi
  trap smoke_cleanup EXIT

  podman pod rm --force --ignore "$SMOKE_POD" >/dev/null
  podman pod create --name "$SMOKE_POD" --publish 127.0.0.1:3200:3000 >/dev/null
  smoke_start_db

  # Started against the empty database: the container applies the migrations and serves the wiki.
  smoke_start_app
  # /folders reads the tables, so its 200 proves that the start created them.
  smoke_require_status /folders
  local asset
  asset="$(curl --silent --max-time 10 "${SMOKE_URL}/folders" | grep -o '/_next/static/[^"\\]*' | awk 'NR == 1')"
  if [[ -z "$asset" ]]; then
    smoke_fail "/folders references no /_next/static/ file."
  fi
  smoke_require_status "$asset"

  # The published port reaches the address of the pod; this shows that the server listens on 127.0.0.1 as well,
  # although Podman sets HOSTNAME to the name of the pod. The slim image has no curl, so node makes the request.
  if ! podman exec "$SMOKE_APP" node -e \
    "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.status === 200 ? 0 : 1), () => process.exit(1))"; then
    smoke_fail "/api/health does not answer 200 on 127.0.0.1:3000 inside ${SMOKE_APP}."
  fi
  echo "ok: /api/health answers 200 on 127.0.0.1:3000 inside the container"

  # PID 1 is the server: the start script replaces itself with it.
  local uid
  uid="$(podman exec "$SMOKE_APP" awk '/^Uid:/ { print $2 }' /proc/1/status)"
  if [[ -z "$uid" || "$uid" == "0" ]]; then
    smoke_fail "the application process runs as root (uid '${uid}')."
  fi
  echo "ok: the application process runs as uid ${uid}"
  if ! podman exec "$SMOKE_APP" sh -c 'test ! -e /app/.env && test ! -e /app/migrate/.env'; then
    smoke_fail "the container has a .env file."
  fi
  echo "ok: no .env file next to server.js or the migration tools"

  local migrations
  migrations="$(smoke_migrations)"
  if [[ -z "$migrations" ]]; then
    smoke_fail "_prisma_migrations has no rows."
  fi
  echo "ok: $(wc -l <<<"$migrations" | tr -d ' ') migrations applied"

  # A second container against the migrated database applies nothing and serves as well.
  podman rm --force "$SMOKE_APP" >/dev/null
  smoke_start_app
  smoke_require_status /folders
  if [[ "$(smoke_migrations)" != "$migrations" ]]; then
    smoke_fail "the second start changed _prisma_migrations."
  fi
  echo "ok: the second start applied no migration"

  # The command that only migrates applies nothing against the migrated database and exits without an error.
  if ! podman run --rm --pod "$SMOKE_POD" --name "$SMOKE_MIGRATE" --env DATABASE_URL="$SMOKE_DATABASE_URL" \
    "$IMAGE" ./image-migrate.sh; then
    smoke_fail "./image-migrate.sh failed against the migrated database."
  fi
  if [[ "$(smoke_migrations)" != "$migrations" ]]; then
    smoke_fail "./image-migrate.sh changed _prisma_migrations."
  fi
  echo "ok: ./image-migrate.sh exits with 0 and applies no migration"

  echo "Smoke test passed."
}

# Fails with a message unless the tag is a valid image tag (letters, digits, _, . and -, at most 128 characters, not
# starting with . or -) other than `latest`, which is never published.
check_tag() {
  local tag="$1"
  if [[ -z "$tag" ]]; then
    echo "The image tag is empty." >&2
    exit 1
  fi
  if ((${#tag} > 128)); then
    echo "The image tag '${tag}' has ${#tag} characters; at most 128 are allowed." >&2
    exit 1
  fi
  if [[ ! "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]]; then
    echo "The image tag '${tag}' is invalid: only letters, digits, _, . and - are allowed, and it must not start with . or -." >&2
    exit 1
  fi
  if [[ "$tag" == "latest" ]]; then
    echo "The image tag 'latest' is not published; name the release with its version." >&2
    exit 1
  fi
}

cmd_check_tag() {
  [[ $# -eq 1 ]] || usage
  check_tag "$1"
  echo "The image tag '$1' is valid."
}

cmd_reference() {
  [[ $# -eq 2 ]] || usage
  local owner="$1" tag="$2"
  if [[ -z "$owner" ]]; then
    echo "The owner is empty." >&2
    exit 1
  fi
  check_tag "$tag"
  echo "ghcr.io/$(tr '[:upper:]' '[:lower:]' <<<"$owner")/hippowiki:${tag}"
}

[[ $# -ge 1 ]] || usage
command="$1"
shift

case "$command" in
  build)
    require_podman
    cmd_build
    ;;
  smoke)
    require_podman
    cmd_smoke
    ;;
  check-tag) cmd_check_tag "$@" ;;
  reference) cmd_reference "$@" ;;
  *) usage ;;
esac
