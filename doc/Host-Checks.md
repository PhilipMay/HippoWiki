## Host Checks

Each of these has a planned answer, which depends on the real host and not on how an AI client behaves. They need the
[NixOS guide](nixos-setup.md) and the app from the first [roadmap step](../spec/roadmap.md#next-steps).

### Document Fetch From the Server

- **Open**: the vendor documents answered during the review, from a developer machine. They sit behind Cloudflare, so a
  data centre address may be treated differently.
- **Recommendation**: run the [check in the guide](nixos-setup.md#checks) from the real host.
- **Alternatives if it fails**: ship copies of the documents in the image and use them when a fetch fails. Trust then
  rests on the image, and a vendor change needs a new image.

### Real Client Address and Secrets in the Journal

- **Open**: which address Podman shows for Traefik, and that `podman exec` output stays out of the journal. Neither has
  been run, and neither has the [NixOS guide](nixos-setup.md) as a whole.
- **Recommendation**: follow the guide once on a test host, and fix it as you go.
- **Alternatives if it fails**: for the address, a different `--forwarded-allow-ips` or a host network for the app. For
  the journal, `--log-driver=none`.
