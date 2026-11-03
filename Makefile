src := src/hippowiki
other-src := tests
md-src := README.md CLAUDE.md spec spec-pure-wiki doc

.PHONY: check format test test-podman install

check:
	uv run black $(src) $(other-src) --check --diff
	uv run ruff check $(src) $(other-src)
	uv run mypy $(src) $(other-src)
	uv run lint-imports
	uv run mdformat $(md-src) --check

format:
	uv run black $(src) $(other-src)
	uv run ruff check $(src) $(other-src) --fix
	uv run mdformat $(md-src)

test:
	uv run pytest $(other-src) -m "not podman"

test-podman: export DOCKER_HOST ?= unix://$(shell podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')
test-podman: export TESTCONTAINERS_RYUK_DISABLED ?= true
test-podman:
	uv run pytest $(other-src) -m podman

install:
	uv sync --locked
