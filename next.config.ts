import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The end-to-end tests set HIPPOWIKI_DIST_DIR=.next-e2e, so their server can run next to `npm run dev`.
  distDir: process.env.HIPPOWIKI_DIST_DIR ?? ".next",
  // Only the container image build sets HIPPOWIKI_OUTPUT=standalone. Otherwise the option stays unset, because
  // `next start` (used by `npm run start` and `npm run test:e2e:production`) warns that it does not work with it.
  output: process.env.HIPPOWIKI_OUTPUT === "standalone" ? "standalone" : undefined,
};

export default nextConfig;
