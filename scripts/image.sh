#!/usr/bin/env bash
# Builds the container image of HippoWiki with Podman (see Containerfile).
# Usage: scripts/image.sh <build>
#   build   builds the image as hippowiki:local for the platform of this machine. IMAGE_VERSION and IMAGE_REVISION,
#           when set, become the labels org.opencontainers.image.version and org.opencontainers.image.revision.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="hippowiki:local"

usage() {
  echo "Usage: $0 <build>" >&2
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

[[ $# -ge 1 ]] || usage
command="$1"
shift

case "$command" in
  build)
    require_podman
    cmd_build
    ;;
  *) usage ;;
esac
