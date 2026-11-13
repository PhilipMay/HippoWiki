# Security Review Fixes – Steps

## Goal

Fix the open findings of `security-review.md` that the code of this repository can fix: the responses carry the
usual security headers, Markdown images no longer load from other hosts, the image optimizer of Next.js is behind the
login like every other address, and the server cannot change its own code in the container image.

## Scope

- In:
  - "Minor: no security headers": the five headers of the suggestion for every address, set in `next.config.ts`.
  - "Minor: Markdown images load from any host": fixed by `img-src 'self' data:` and `Referrer-Policy: same-origin`
    of the headers above, without a change to `MarkdownContent`.
  - "Nit: the `X-Powered-By: Next.js` header is sent": `poweredByHeader: false`.
  - "Nit: the image optimizer answers without a login": `_next/image` is removed from the matcher of `src/proxy.ts`.
  - "Nit: the runtime user can change the server code in the image": the files of the image belong to root, and
    `node` can write only `.next/cache`.
  - The checks of the smoke test of the container image for these changes.
  - Removing each fixed issue from `security-review.md` in the step that fixes it.
- Not in:
  - "Minor: logins without an account can block all logins": neither the rate limit in the reverse proxy of the
    deployment nor a limit per client address group in the server. The issue stays open in `security-review.md`.
  - Changes to the deployment and its reverse proxy, and checking the fixes on the deployment; that needs a release.
  - A `script-src` or `style-src` in the Content Security Policy, with or without nonces: Material UI and Next.js
    insert inline styles and scripts, and the policy of the suggestion does not restrict them.
  - Showing Markdown images from other hosts in another way, for example through a proxy of the server, and a
    message in the page view for a blocked image.
  - Turning off the image optimizer of Next.js for logged-in users.

## Checklist

- [ ] Security headers
- [ ] Image optimizer behind the login
- [ ] Server files owned by root
- [ ] Wrap-up

## Security headers

### Goal

Every response of the server carries `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`,
`X-Content-Type-Options` and `Referrer-Policy`, and no longer `X-Powered-By`. This fixes three issues of
`security-review.md`: the missing security headers, Markdown images from any host, and the `X-Powered-By` header.

### Build

- Read `headers.md` and `poweredByHeader.md` in `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/`
  first.
- `next.config.ts`:
  - `poweredByHeader: false`.
  - An `async headers()` with one entry for the source `/:path*` and these headers, as the suggestion of the review
    gives them:
    - `Strict-Transport-Security: max-age=63072000; includeSubDomains`
    - `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; img-src 'self' data:`
    - `X-Frame-Options: DENY`
    - `X-Content-Type-Options: nosniff`
    - `Referrer-Policy: same-origin`
  - A comment on each header that says what it protects against, and on `img-src` that it keeps Markdown images of
    other hosts from loading. Browsers ignore `Strict-Transport-Security` over plain HTTP, so `npm run dev` and the
    end-to-end server on `localhost` are not affected; say so in the comment.
- `scripts/image.sh`, smoke test: `/login` of the image answers with the five headers and their values and without
  `X-Powered-By`. A helper `smoke_require_header` next to `smoke_require_status`, with a message that names the
  header and the value it got.
- `security-review.md`: remove the issues "Minor: no security headers", "Minor: Markdown images load from any host"
  and "Nit: the `X-Powered-By: Next.js` header is sent".

### Test

- End-to-end, a new spec `e2e/security-headers.spec.ts`:
  - The five headers with their exact values, and no `X-Powered-By`, on: `/login` without a login, the redirect of
    `/folders` to the login page without a login, `/api/health`, a page of a folder with the login of the normal
    user, and the first `/_next/static/` file that the login page references.
  - A page whose content has an image from another host, `![](https://tracker.example/x.png)`: the browser does not
    request it (a `page.route()` for `https://tracker.example/**` is never called), and it reports the violation of
    the Content Security Policy (a `securitypolicyviolation` event whose `effectiveDirective` is `img-src`).
    `collectErrors()` holds only the console error of this violation.
  - A page whose content has a `data:` image: it loads (`naturalWidth` above 0) without an error.
- `next.config.ts` is something every page depends on, so the complete `npm run test:e2e` runs in this step. A spec
  whose page shows an image from another host and asserts that `collectErrors()` stays empty fails now; such a spec
  uses an image of the wiki or a `data:` image instead.
- `npm run test:e2e:production -- e2e/security-headers.spec.ts`, after `npm run build`: the files of `_next/static/`
  are served differently by a production build.
- `npm run image:build` and `npm run image:smoke`, last, after the commands above: the smoke test checks the headers of
  the standalone server of the image.

## Image optimizer behind the login

### Goal

`/_next/image` without a session cookie is sent to the login page like every other address, so that nobody without a
login can make the server fetch its own pages through the image optimizer. This fixes "Nit: the image optimizer
answers without a login" of `security-review.md`.

### Build

- `src/proxy.ts`: remove `|_next/image` from `config.matcher`. The comment above the matcher already names only the
  login page, the health check and the static files; check that it still describes the matcher exactly.
- `e2e/access.spec.ts`: the address of the review, `/_next/image?url=%2Ffolders&w=64&q=75`, in
  `PROTECTED_ADDRESSES`, as "the image optimizer".
- `scripts/image.sh`, smoke test: `/_next/image?url=%2Ffolders&w=64&q=75` redirects to the login page, with
  `smoke_require_login_redirect` next to the one for `/folders`, in the first application container.
- `security-review.md`: remove the issue "Nit: the image optimizer answers without a login". In "Checked and Found
  Fine", the entry "Unauthenticated access" no longer points to the removed issue; it says that the code sends
  `/_next/image` to the login page as well, and that the deployment still answers it until it runs a release with
  this change.

### Test

- End-to-end: the new case of `e2e/access.spec.ts` redirects to the login page and shows nothing of the page.
- `src/proxy.ts` is something every page depends on, so the complete `npm run test:e2e` runs in this step.
- `npm run image:build` and `npm run image:smoke`, last, after the commands of "When a step is done".

## Server files owned by root

### Goal

The files of the server in the container image belong to root, and the user `node`, as which the server runs, can
write only `.next/cache`. Code that runs as `node` can no longer change `server.js` or the rest of the server. This
fixes "Nit: the runtime user can change the server code in the image" of `security-review.md`.

### Build

- `Containerfile`, stage `app`:
  - Remove `--chown=node:node` from the `COPY` lines of the standalone output, of `.next/static` and of `admin.mjs`.
  - Before `USER node`, a `RUN` that creates `/app/.next/cache` and gives it to `node`, so that the server can still
    write its cache. Nothing else of `/app` belongs to `node`.
  - Update the comment that says the files are owned by `node`.
- `scripts/image.sh`, smoke test, in the running application container, checked with `node` as the user of the
  container:
  - `/app/server.js`, `/app/admin.mjs` and the directory `/app/.next/server` are not writable.
  - `/app/.next/cache` is writable: a file can be created in it and removed again.
- `security-review.md`: remove the issue "Nit: the runtime user can change the server code in the image".

### Test

- `npm run image:build` and `npm run image:smoke`, last, after the commands of "When a step is done": the new checks
  pass, and so do the existing ones, among them the admin setup in the first container, the login page and the start
  of the second container.
- No end-to-end spec runs: the end-to-end server does not use the container image.

## Wrap-up

### Goal

Move the lasting content of this plan into the other spec files and remove the plan.

### Build

1. Describe the changes as built in the existing specs:
   - `architecture.md`: in "Login and sessions", that the matcher of `src/proxy.ts` leaves out the static files of
     Next.js but not the image optimizer; a new section or bullet on the security headers in `next.config.ts`, which
     every new route gets without doing anything, and that `img-src 'self' data:` keeps images of other hosts out.
   - `users-and-login.md`: "Authenticated access only" says that `/_next/image` is behind the login as well.
   - `pages.md`: the page view shows Markdown images only from the wiki itself and `data:` URLs; an image from
     another host is blocked by the browser. The same under "Current limits".
   - `container-image.md`: the ownership in the stage `app` (root, with `.next/cache` for `node`), the new checks of
     the smoke test (headers, `/_next/image`, write access), and in "What the environment has to provide" that the
     server sets the security headers itself, so a reverse proxy does not have to.
   - `testing.md`: `e2e/security-headers.spec.ts` and what it checks, next to `e2e/access.spec.ts`.
   - `security-review.md`: its introduction says which issues were fixed after the review and that the deployment
     still has to be checked after a release with them. Only "Minor: logins without an account can block all logins"
     is left under "Issues".
2. `roadmap.md` has no entry for these fixes. In "Operations", the entry "Reverse proxy with TLS" no longer names the
   security headers, only the login rate limit of `security-review.md`. "Things to Check" gets an entry: the five
   headers on the deployment and the redirect of `/_next/image`, after the next release.
3. Check that `README.md` has all the commands a developer needs.
4. Delete this step file.
5. Update the spec catalog in `CLAUDE.md`: remove this step file, and update the descriptions of the specs above where
   they no longer fit.

### Test

- The commands in "When a step is done" in `spec/workflow.md` pass.
