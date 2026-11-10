export const siteName = "HippoWiki";

export const siteDescription = "A knowledge management system.";

export function pageTitle(title?: string): string {
  const trimmed = title?.trim();
  return trimmed ? `${trimmed} – ${siteName}` : siteName;
}
