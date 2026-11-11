#!/usr/bin/env bash
# Manages the local development database in Podman.
# Usage: scripts/db.sh <up|down|reset|psql|logs> [args...]
set -euo pipefail

cd "$(dirname "$0")/.."

# Database name, user and password come from .env (see .env.example).
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
POSTGRES_DB="${POSTGRES_DB:-hippowiki}"
POSTGRES_USER="${POSTGRES_USER:-hippowiki}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-hippowiki}"

CONTAINER="hippowiki-db"
VOLUME="hippowiki-db-data"
# The image is pinned in scripts/Containerfile, which the test database container reads as well.
IMAGE="$(awk '$1 == "FROM" { print $2; exit }' scripts/Containerfile)"
if [[ -z "$IMAGE" ]]; then
  echo "No FROM line with the PostgreSQL image found in scripts/Containerfile." >&2
  exit 1
fi
# Since PostgreSQL 18 the image keeps its data in /var/lib/postgresql/<major>/docker,
# so the volume is mounted at the parent directory.
DATA_DIR="/var/lib/postgresql"
PORT="127.0.0.1:5432:5432"
READY_TIMEOUT_SECONDS=60

usage() {
  echo "Usage: $0 <up|down|reset|psql|logs> [args...]" >&2
  exit 1
}

require_podman() {
  if ! podman info >/dev/null 2>&1; then
    echo "Podman is not reachable. Start the Podman machine with: podman machine start" >&2
    exit 1
  fi
}

container_exists() {
  podman container exists "$CONTAINER"
}

container_running() {
  [[ "$(podman container inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" == "true" ]]
}

wait_until_ready() {
  # Checks over TCP: while the image initializes a new database, its temporary server
  # only listens on the Unix socket and must not count as ready.
  local waited=0
  until podman exec "$CONTAINER" pg_isready -q -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>/dev/null; do
    if ((waited >= READY_TIMEOUT_SECONDS)); then
      echo "Database did not become ready within ${READY_TIMEOUT_SECONDS}s. Last log lines:" >&2
      podman logs --tail 20 "$CONTAINER" >&2 || true
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "Database is ready at localhost:5432 (database ${POSTGRES_DB}, user ${POSTGRES_USER})."
}

cmd_up() {
  if container_running; then
    echo "Container ${CONTAINER} is already running."
  elif container_exists; then
    echo "Starting container ${CONTAINER}..."
    podman start "$CONTAINER" >/dev/null
  else
    echo "Creating container ${CONTAINER} from ${IMAGE}..."
    podman run --detach \
      --name "$CONTAINER" \
      --env POSTGRES_DB="$POSTGRES_DB" \
      --env POSTGRES_USER="$POSTGRES_USER" \
      --env POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
      --publish "$PORT" \
      --volume "${VOLUME}:${DATA_DIR}" \
      "$IMAGE" >/dev/null
  fi
  wait_until_ready
}

cmd_down() {
  if container_exists; then
    echo "Stopping and removing container ${CONTAINER} (volume ${VOLUME} is kept)..."
    podman stop --time 30 "$CONTAINER" >/dev/null
    podman rm "$CONTAINER" >/dev/null
  else
    echo "Container ${CONTAINER} does not exist."
  fi
}

cmd_reset() {
  cmd_down
  echo "Removing volume ${VOLUME}..."
  podman volume rm --force "$VOLUME" >/dev/null 2>&1 || true
  cmd_up
}

cmd_psql() {
  local flags=(--interactive)
  if [[ -t 0 && -t 1 ]]; then
    flags+=(--tty)
  fi
  podman exec "${flags[@]}" "$CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}

cmd_logs() {
  podman logs "$@" "$CONTAINER"
}

[[ $# -ge 1 ]] || usage
command="$1"
shift

require_podman

case "$command" in
  up) cmd_up ;;
  down) cmd_down ;;
  reset) cmd_reset ;;
  psql) cmd_psql "$@" ;;
  logs) cmd_logs "$@" ;;
  *) usage ;;
esac
