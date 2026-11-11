"use client";

import { useEffect } from "react";

import { useHydrated } from "@/lib/hydration";

/**
 * Sets `data-hydrated="true"` on `<html>` once the page has hydrated. It uses `useHydrated()`, so the mark is set in the
 * same commit that unlocks the controls of all Client Components. The end-to-end tests wait for it after every page
 * load, so they never act on the server-rendered, still locked page.
 */
export default function HydrationMarker() {
  const hydrated = useHydrated();

  useEffect(() => {
    if (hydrated) document.documentElement.dataset.hydrated = "true";
  }, [hydrated]);

  return null;
}
