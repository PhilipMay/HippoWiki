"use client";

// Re-exports next/link from a Client Component module, so that Server Components can pass it to Material UI
// components as `component={Link}`.
import Link from "next/link";

export default Link;
