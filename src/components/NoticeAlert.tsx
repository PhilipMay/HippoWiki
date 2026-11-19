"use client";

import Alert from "@mui/material/Alert";
import { useEffect, type ReactNode } from "react";

type NoticeAlertProps = {
  /** The query parameter of the address that holds the notice, removed once it is shown. */
  param: string;
  /** `warning` for a notice that asks the user to do something, such as revoking apps that could not be. */
  severity?: "success" | "warning";
  /** What happened, in a sentence. */
  children: ReactNode;
};

/**
 * A notice that reports what an action did, such as a changed password, shown once: once hydrated, it removes its
 * parameter from the address with the native History API, which Next.js integrates into its router, so that a reload
 * or a bookmark shows no message. It only reports and changes nothing.
 */
export default function NoticeAlert({ param, severity = "success", children }: NoticeAlertProps) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(param)) return;
    url.searchParams.delete(param);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [param]);

  return (
    <Alert severity={severity} role="status">
      {children}
    </Alert>
  );
}
