import type { NextConfig } from "next";

/** The security headers of every response, the login redirect of `src/proxy.ts` and the static files included. */
const SECURITY_HEADERS = [
  // Against downgrading a later visit to plain HTTP: the browser uses only HTTPS for two years. Browsers ignore the
  // header on a plain HTTP response, so `npm run dev` and the end-to-end server on localhost are not affected.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // A second line of defence for content that users write. `frame-ancestors` forbids embedding the wiki in a frame
  // (clickjacking), `object-src` forbids plugins, `base-uri` and `form-action` keep links and forms on this site.
  // `img-src 'self' data:` keeps images of other hosts, e.g. a tracking image in Markdown, from loading. There is no
  // `script-src` or `style-src`: Material UI and Next.js insert inline styles and scripts.
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; img-src 'self' data:",
  },
  // Against clickjacking in older browsers, which do not know `frame-ancestors`.
  { key: "X-Frame-Options", value: "DENY" },
  // Against the browser guessing another content type than the one the server sends, e.g. running a file as script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Against leaking the address of a page, with its folder and page names, to other sites.
  { key: "Referrer-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // The end-to-end tests set HIPPOWIKI_DIST_DIR=.next-e2e, so their server can run next to `npm run dev`.
  distDir: process.env.HIPPOWIKI_DIST_DIR ?? ".next",
  // Only the container image build sets HIPPOWIKI_OUTPUT=standalone. Otherwise the option stays unset, because
  // `next start` (used by `npm run start` and `npm run test:e2e:production`) warns that it does not work with it.
  output: process.env.HIPPOWIKI_OUTPUT === "standalone" ? "standalone" : undefined,
  // No `X-Powered-By: Next.js`, which names the framework to everyone.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
