# HippoWiki

This is a knowledge management system for AI and natural intelligence.

## Specification

The design and planning documents are in [spec/](spec/).

## Development

This project uses [uv](https://docs.astral.sh/uv/).

- `make install`: install the dependencies from the lock file
- `make format`: format the code and the documents
- `make check`: run all static checks
- `make test`: run the tests, which need no Podman
- `make test-podman`: run the tests against a real PostgreSQL, which need a running Podman machine
