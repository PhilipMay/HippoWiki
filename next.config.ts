import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The end-to-end tests set HIPPOWIKI_DIST_DIR=.next-e2e, so their server can run next to `npm run dev`.
  distDir: process.env.HIPPOWIKI_DIST_DIR ?? ".next",
};

export default nextConfig;
