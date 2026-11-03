## Experiments

Most open questions about real clients are checks of the [Connector Test](../spec/roadmap.md#connector-test).
Documentation could not settle these others:

- **`eager_defaults`:** a `podman` test that assigns `func.now()` in an `AsyncSession`, flushes and reads. Expect
  `MissingGreenlet`.
- **Stale reads:** run the existing race test against the first repository code. Expect a 500 unless the re-read is
  fixed.
- **Traefik:** run `traefik version` on the host.
- **Podman compose:** test the wait for `migrate` with the version in use.
- **`BaseHTTPMiddleware`:** run one streaming transport test with a wrapper, if you want the reason settled.
