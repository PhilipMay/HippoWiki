#!/usr/bin/env bash
# Builds the container image of HippoWiki with Podman (see Containerfile) and checks it.
# Usage: scripts/image.sh <build|smoke|check-tag|reference> [args...]
#   build   builds the image as hippowiki:local for the platform of this machine. IMAGE_VERSION and IMAGE_REVISION,
#           when set, become the labels org.opencontainers.image.version and org.opencontainers.image.revision.
#   smoke   runs the image of `build` against a throwaway, empty database and checks that it installs itself,
#           creates the admin account and serves the wiki, behind its login. It removes everything it started, also when a check fails.
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
SMOKE_ADMIN="hippowiki-smoke-admin"
SMOKE_URL="http://127.0.0.1:3200"
SMOKE_DB_NAME="hippowiki_smoke"
SMOKE_DB_USER="hippowiki_smoke"
SMOKE_DB_PASSWORD="hippowiki_smoke"
SMOKE_DATABASE_URL="postgresql://${SMOKE_DB_USER}:${SMOKE_DB_PASSWORD}@127.0.0.1:5432/${SMOKE_DB_NAME}"
# The first password of the admin account that the first container creates.
SMOKE_ADMIN_PASSWORD="smoke-admin-password"
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

# Starts a container of the image against the database and waits until /api/health reports ok. Its arguments are
# further options of `podman run`, such as --env.
smoke_start_app() {
  echo "Starting ${IMAGE}..."
  podman run --detach \
    --pod "$SMOKE_POD" \
    --name "$SMOKE_APP" \
    --env DATABASE_URL="$SMOKE_DATABASE_URL" \
    "$@" \
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

# Prints the value of a response header of a GET request, or nothing when the response lacks it. Header names are
# compared without regard to case.
http_header() {
  local path="$1" name="$2"
  curl --silent --output /dev/null --dump-header - --max-time 10 "${SMOKE_URL}${path}" |
    tr -d '\r' |
    awk -v name="$name" '
      BEGIN { name = tolower(name) }
      {
        colon = index($0, ":")
        if (colon > 0 && tolower(substr($0, 1, colon - 1)) == name) {
          value = substr($0, colon + 1)
          sub(/^[ \t]+/, "", value)
          print value
          exit
        }
      }' ||
    true
}

# Fails unless the response of the path has the header with exactly the value.
smoke_require_header() {
  local path="$1" name="$2" expected="$3" actual
  actual="$(http_header "$path" "$name")"
  if [[ "$actual" != "$expected" ]]; then
    smoke_fail "${path} sent ${name} '${actual}' instead of '${expected}'."
  fi
  echo "ok: ${path} sends ${name}: ${expected}"
}

# Fails when the response of the path has the header, whatever its value.
smoke_require_no_header() {
  local path="$1" name="$2" actual
  actual="$(http_header "$path" "$name")"
  if [[ -n "$actual" ]]; then
    smoke_fail "${path} sent ${name} '${actual}', which it must not send."
  fi
  echo "ok: ${path} sends no ${name}"
}

# Starts a container of the image that must not serve: it has to exit with a non-zero code. $1 says what is wrong
# with its environment, $2 is a text that its output must contain; further arguments are options of `podman run`.
smoke_require_failed_start() {
  local what="$1" message="$2"
  shift 2
  echo "Starting ${IMAGE} ${what}..."
  podman run --detach \
    --pod "$SMOKE_POD" \
    --name "$SMOKE_APP" \
    --env DATABASE_URL="$SMOKE_DATABASE_URL" \
    "$@" \
    "$IMAGE" >/dev/null
  local waited=0
  while [[ "$(podman container inspect --format '{{.State.Running}}' "$SMOKE_APP")" == "true" ]]; do
    if [[ "$(curl --silent --max-time 5 "${SMOKE_URL}/api/health" || true)" == '{"status":"ok"}' ]]; then
      smoke_fail "the container ${what} serves instead of exiting."
    fi
    if ((waited >= READY_TIMEOUT_SECONDS)); then
      smoke_fail "the container ${what} did not exit within ${READY_TIMEOUT_SECONDS}s."
    fi
    sleep 1
    waited=$((waited + 1))
  done
  local code output
  code="$(podman container inspect --format '{{.State.ExitCode}}' "$SMOKE_APP")"
  if [[ "$code" == "0" ]]; then
    smoke_fail "the container ${what} exited with code 0."
  fi
  output="$(podman logs "$SMOKE_APP" 2>&1)"
  if [[ "$output" != *"$message"* ]]; then
    smoke_fail "the output of the container ${what} lacks the message '${message}'."
  fi
  podman rm --force "$SMOKE_APP" >/dev/null
  echo "ok: the container ${what} exits with code ${code} instead of serving"
}

# Runs a query in the smoke test database and prints its rows, with the fields separated by |.
smoke_sql() {
  podman exec "$SMOKE_DB" psql -At -U "$SMOKE_DB_USER" -d "$SMOKE_DB_NAME" -c "$1"
}

# Fails unless the path redirects to the login page, as every address does without a login.
smoke_require_login_redirect() {
  local path="$1" answer
  answer="$(curl --silent --output /dev/null --write-out '%{http_code} %{redirect_url}' --max-time 10 "${SMOKE_URL}${path}" || true)"
  if [[ "$answer" != "307 ${SMOKE_URL}/login" ]]; then
    smoke_fail "${path} answered '${answer}' instead of a redirect to the login page."
  fi
  echo "ok: ${path} redirects to the login page"
}

smoke_migrations() {
  smoke_sql "SELECT id, migration_name, checksum, started_at, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name"
}

# The users with their password hashes, to compare them before and after a start.
smoke_users() {
  smoke_sql 'SELECT u.id, u.username, u."mustChangePassword", u."updatedAt", a.password FROM "User" u JOIN "Account" a ON a."userId" = u.id ORDER BY u.username'
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

  # Without a valid password for the admin account, a container against the empty database must not serve. It applies
  # the migrations first, so the table of the users exists afterwards and must be empty.
  smoke_require_failed_start "without HIPPOWIKI_ADMIN_PASSWORD" "HIPPOWIKI_ADMIN_PASSWORD is not set"
  smoke_require_failed_start "with a HIPPOWIKI_ADMIN_PASSWORD of 7 characters" \
    "Password must be at least 8 characters" --env HIPPOWIKI_ADMIN_PASSWORD=1234567
  if [[ "$(smoke_sql 'SELECT count(*) FROM "User"')" != "0" ]]; then
    smoke_fail "a start that failed created a user."
  fi
  echo "ok: the starts that failed created no user"

  # Started with a password: the container applies no further migration, creates the admin and serves the wiki.
  smoke_start_app --env HIPPOWIKI_ADMIN_PASSWORD="$SMOKE_ADMIN_PASSWORD"
  local admin
  admin="$(smoke_sql 'SELECT username, "mustChangePassword" FROM "User"')"
  if [[ "$admin" != "admin|t" ]]; then
    smoke_fail "the table User has '${admin}' instead of the one row 'admin|t'."
  fi
  echo "ok: the start created the admin account, with a pending password change"
  local users
  users="$(smoke_users)"
  if [[ "$users" != *'|admin|t|'*'|$argon2id$'* ]]; then
    smoke_fail "the admin account has no Argon2id password hash."
  fi
  # The native build of the password hashing for the platform of the image loads and hashes.
  if ! podman exec "$SMOKE_APP" node -e \
    "import('@node-rs/argon2').then(async ({ hash, verify }) => process.exit((await verify(await hash('smoke'), 'smoke')) ? 0 : 1)).catch(() => process.exit(1))"; then
    smoke_fail "@node-rs/argon2 does not load or hash in /app inside ${SMOKE_APP}."
  fi
  echo "ok: @node-rs/argon2 loads and hashes inside the container"
  # The login page is the one page that needs no login. It reads the secret of the session cookies, which the
  # server stores on first use, so the row proves that the page was rendered with the database.
  smoke_require_status /login
  if [[ "$(smoke_sql 'SELECT count(*) FROM "AuthSecret"')" != "1" ]]; then
    smoke_fail "the server stored no secret for the session cookies."
  fi
  echo "ok: the server stored the secret of the session cookies"
  # The security headers of next.config.ts, which the standalone server sets itself.
  smoke_require_header /login Strict-Transport-Security "max-age=63072000; includeSubDomains"
  smoke_require_header /login Content-Security-Policy \
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; img-src 'self' data:"
  smoke_require_header /login X-Frame-Options DENY
  smoke_require_header /login X-Content-Type-Options nosniff
  smoke_require_header /login Referrer-Policy same-origin
  smoke_require_no_header /login X-Powered-By
  local asset
  asset="$(curl --silent --max-time 10 "${SMOKE_URL}/login" | grep -o '/_next/static/[^"\\]*' | awk 'NR == 1')"
  if [[ -z "$asset" ]]; then
    smoke_fail "/login references no /_next/static/ file."
  fi
  smoke_require_status "$asset"
  # Everything else needs a login, the image optimizer of Next.js included.
  smoke_require_login_redirect /folders
  smoke_require_login_redirect "/_next/image?url=%2Ffolders&w=64&q=75"

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
  # The files of the server belong to root: the user of the server can write only the cache of Next.js.
  if ! podman exec --user node "$SMOKE_APP" sh -c \
    'test ! -w /app/server.js && test ! -w /app/admin.mjs && test ! -w /app/.next/server'; then
    smoke_fail "the user node can write /app/server.js, /app/admin.mjs or /app/.next/server."
  fi
  echo "ok: the user node cannot write server.js, admin.mjs or .next/server"
  if ! podman exec --user node "$SMOKE_APP" sh -c \
    'file=/app/.next/cache/smoke-write-test && touch "$file" && rm "$file"'; then
    smoke_fail "the user node cannot create and remove a file in /app/.next/cache."
  fi
  echo "ok: the user node can write /app/.next/cache"

  local migrations
  migrations="$(smoke_migrations)"
  if [[ -z "$migrations" ]]; then
    smoke_fail "_prisma_migrations has no rows."
  fi
  echo "ok: $(wc -l <<<"$migrations" | tr -d ' ') migrations applied"

  # A second container against the migrated database applies nothing and serves as well. It needs no password for
  # the admin account, because the admin exists.
  podman rm --force "$SMOKE_APP" >/dev/null
  smoke_start_app
  smoke_require_status /login
  smoke_require_login_redirect /folders
  if [[ "$(smoke_migrations)" != "$migrations" ]]; then
    smoke_fail "the second start changed _prisma_migrations."
  fi
  echo "ok: the second start applied no migration"
  if [[ "$(smoke_users)" != "$users" ]]; then
    smoke_fail "the second start changed the admin account."
  fi
  echo "ok: the second start, without HIPPOWIKI_ADMIN_PASSWORD, left the admin account as it was"

  # The command that only migrates applies nothing against the migrated database and exits without an error.
  if ! podman run --rm --pod "$SMOKE_POD" --name "$SMOKE_MIGRATE" --env DATABASE_URL="$SMOKE_DATABASE_URL" \
    "$IMAGE" ./image-migrate.sh; then
    smoke_fail "./image-migrate.sh failed against the migrated database."
  fi
  if [[ "$(smoke_migrations)" != "$migrations" ]]; then
    smoke_fail "./image-migrate.sh changed _prisma_migrations."
  fi
  echo "ok: ./image-migrate.sh exits with 0 and applies no migration"

  # The command that only sets up the admin does nothing when the admin exists, also with another password.
  if ! podman run --rm --pod "$SMOKE_POD" --name "$SMOKE_ADMIN" --env DATABASE_URL="$SMOKE_DATABASE_URL" \
    --env HIPPOWIKI_ADMIN_PASSWORD="another-${SMOKE_ADMIN_PASSWORD}" "$IMAGE" ./image-admin.sh; then
    smoke_fail "./image-admin.sh failed although the admin account exists."
  fi
  if [[ "$(smoke_users)" != "$users" ]]; then
    smoke_fail "./image-admin.sh changed the admin account."
  fi
  echo "ok: ./image-admin.sh exits with 0 and leaves the admin account as it was"

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
