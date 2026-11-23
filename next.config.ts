import type { NextConfig } from "next";

/**
 * Against downgrading a later visit to plain HTTP: the browser uses only HTTPS for two years. Browsers ignore the header
 * on a plain HTTP response, so `npm run dev` and the end-to-end server on localhost are not affected.
 */
const STRICT_TRANSPORT_SECURITY = { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" };

/**
 * The security headers of every response but the files themselves, the login redirect of `src/proxy.ts` and the
 * static files included.
 */
const SECURITY_HEADERS = [
  STRICT_TRANSPORT_SECURITY,
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

/**
 * The headers of the addresses of the files themselves, `/files/…`, instead of those of the app: an uploaded file must
 * never run code in the wiki, also when a browser opens it on its own. The route of a file adds its type, its name and
 * its caching (`src/features/files/http.ts`).
 */
const FILE_HEADERS = [
  STRICT_TRANSPORT_SECURITY,
  // Nothing in a file may load anything (`default-src 'none'`), and the browser opens it in a sandbox of its own, as a
  // document of no origin that runs no script and sends no form.
  { key: "Content-Security-Policy", value: "default-src 'none'; sandbox" },
  // The browser uses the type the wiki decided from the content at the upload, never one it guesses.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No page of another site may load a file of the wiki, such as an image of a folder it has no role on.
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // No page, of this site or another, may show a file in a frame.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // The end-to-end tests set HIPPOWIKI_DIST_DIR to a directory below .next-e2e/, one per server, so their servers can
  // run next to `npm run dev` and next to each other.
  distDir: process.env.HIPPOWIKI_DIST_DIR ?? ".next",
  // Only the container image build sets HIPPOWIKI_OUTPUT=standalone. Otherwise the option stays unset, because
  // `next start` (used by `npm run start` and `npm run test:e2e:production`) warns that it does not work with it.
  output: process.env.HIPPOWIKI_OUTPUT === "standalone" ? "standalone" : undefined,
  // No `X-Powered-By: Next.js`, which names the framework to everyone.
  poweredByHeader: false,
  // The image optimizer is switched off: the app uses no `next/image`, and the optimizer would fetch any local address
  // given as `url` and run it through the image processing of the server. With this option Next.js answers
  // `/_next/image` with 404 (`render404()` in the image route of `next-server.js`, checked before the query is read),
  // under `next dev` and `next start` alike; without a session cookie `src/proxy.ts` sends it to the login page first.
  // The images of files are processed when they are uploaded, in a route of their own (`src/features/files/`).
  images: { unoptimized: true },
  // The development server logs every incoming request with its address. A file address and an upload address with a
  // query are left out, because the query of a download or an upload by a signed link holds its token, which no log of
  // the wiki may hold; every query of these addresses is left out, not only `token`, since the key may also be written
  // percent-encoded. A production server logs no requests.
  logging: { incomingRequests: { ignore: [/^\/files\/[^?]*\?/, /^\/api\/uploads\/[^?]*\?/] } },
  async headers() {
    return [
      // Every address but `/files` and those below it, which get the headers of the files instead.
      { source: "/:path((?!files(?:/|$)).*)", headers: SECURITY_HEADERS },
      { source: "/files/:path*", headers: FILE_HEADERS },
    ];
  },
};

export default nextConfig;
