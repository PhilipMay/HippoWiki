"use client";

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useId, useState } from "react";

import { useHydrated } from "@/lib/hydration";

type McpAddressProps = {
  /** The full MCP address, which the button copies. */
  address: string;
  /** The label of the field, e.g. "Reader address". */
  label: string;
};

/**
 * An MCP address of a folder in a read-only field, with a button that copies the full address. The button is
 * disabled until hydration, because a click before then would do nothing. Without access to the clipboard the
 * address can still be selected in the field.
 */
export default function McpAddress({ address, label }: McpAddressProps) {
  const hydrated = useHydrated();
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const fieldId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
      <TextField
        id={fieldId}
        label={label}
        value={address}
        size="small"
        fullWidth
        slotProps={{ htmlInput: { readOnly: true, spellCheck: false, style: { fontFamily: "monospace" } } }}
      />
      <Button
        type="button"
        variant="outlined"
        disabled={!hydrated}
        onClick={() => void copy()}
        aria-label={`Copy ${label.toLowerCase()}`}
        sx={{ flexShrink: 0, minWidth: 96 }}
      >
        {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
      </Button>
    </Stack>
  );
}
