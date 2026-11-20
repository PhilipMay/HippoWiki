"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** What a form needs of the guard: the address a held link leads to, and the answers of the dialog. */
type UnsavedChangesGuard = {
  /** The address of the link that was held, while the dialog "Discard changes?" asks; `null` otherwise. */
  heldHref: string | null;
  /** Closes the dialog and stays in the editor. */
  keepEditing(): void;
  /** Closes the dialog and follows the held link. */
  discard(): void;
};

/** The link of a plain left click that leads to an address of the app in the same tab, or `null`. */
function appLink(event: MouseEvent): URL | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement)) return null;
  if ((link.target !== "" && link.target !== "_self") || link.hasAttribute("download")) return null;
  const url = new URL(link.href);
  return url.origin === window.location.origin ? url : null;
}

/**
 * Asks before the editor is left while `active`, that is while its content differs from the content it was opened
 * with and no save runs: closing or reloading the tab asks the browser's own question, and a plain click on a
 * link of the app, "Cancel" included, is held and asks with the dialog "Discard changes?". Links opened in a new tab
 * are not held, nor is the back button of the browser. The listeners are removed as soon as the guard is inactive and
 * when the form unmounts, so that saving never asks and no listener outlives the editor.
 */
export function useUnsavedChangesGuard(active: boolean): UnsavedChangesGuard {
  const router = useRouter();
  const [heldHref, setHeldHref] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers ask only when the event has a return value.
      event.returnValue = "";
    };
    // In the capture phase, before the link of Next.js navigates.
    const click = (event: MouseEvent) => {
      const url = appLink(event);
      if (!url) return;
      event.preventDefault();
      event.stopPropagation();
      setHeldHref(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [active]);

  return {
    heldHref,
    keepEditing: () => setHeldHref(null),
    discard: () => {
      setHeldHref(null);
      if (heldHref !== null) router.push(heldHref);
    },
  };
}
