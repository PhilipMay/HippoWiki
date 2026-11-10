import type { Metadata } from "next";

import { pageTitle, siteDescription } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle(),
  description: siteDescription,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
