"use client";

import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import { searchPath } from "@/lib/addresses";
import { useHydrated } from "@/lib/hydration";

type SearchFieldProps = {
  /** The folder that a search covers, wherever in it the field is shown. */
  folderName: string;
  /** The words of the search in the results view, as typed; empty elsewhere. */
  words?: string;
};

/**
 * The search field of a folder: Enter opens the results of the whole folder for the words as typed, also when they
 * are the title of a page. Typing sends nothing, and Enter in an empty field, or one of spaces only, does nothing. The
 * field is read-only until the component has hydrated.
 */
export default function SearchField({ folderName, words = "" }: SearchFieldProps) {
  const router = useRouter();
  const hydrated = useHydrated();

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = new FormData(event.currentTarget).get("q");
    if (typeof typed !== "string" || typed.trim() === "") return;
    router.push(searchPath(folderName, typed));
  }

  return (
    <Box component="form" role="search" aria-label="Search this folder" onSubmit={search}>
      <TextField
        name="q"
        type="search"
        label="Search this folder"
        defaultValue={words}
        size="small"
        fullWidth
        autoComplete="off"
        slotProps={{ htmlInput: { readOnly: !hydrated } }}
      />
    </Box>
  );
}
