"use client";

import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import TextField from "@mui/material/TextField";
import { useId, type Ref } from "react";

import { PLACE_FIELD } from "@/features/pages/schema";
import { pagePath } from "@/lib/addresses";
import { NAME_MAX_LENGTH } from "@/lib/names";

/** The value of the place "directly in the folder": no tab. */
export const FOLDER_TARGET = "";

type PageNameAndPlaceFieldsProps = {
  /** The name of the page's folder, for the address shown below the name. */
  folderName: string;
  /** The tabs of the folder, in display order. */
  tabs: { id: string; name: string }[];
  /** The name as entered. */
  name: string;
  onNameChange: (name: string) => void;
  /** The chosen place: the id of a tab, or `FOLDER_TARGET` for the folder itself. */
  place: string;
  onPlaceChange: (place: string) => void;
  /** The error to show at the name field, if any. */
  nameError?: string;
  /** Ref to the name input, for moving the focus to it. */
  nameRef: Ref<HTMLInputElement>;
  /**
   * Makes the name read-only and disables the places, for dialogs that render before hydration, when input could be
   * lost.
   */
  locked: boolean;
};

/**
 * The name field of a page, with the address it gets below it, and the choice of its place: directly in the folder or
 * one of its tabs. Shared by the "Save page" and the "Move or rename page" dialog; the dialog keeps name and place in
 * its state.
 */
export default function PageNameAndPlaceFields({
  folderName,
  tabs,
  name,
  onNameChange,
  place,
  onPlaceChange,
  nameError,
  nameRef,
  locked,
}: PageNameAndPlaceFieldsProps) {
  const placeLabelId = useId();
  const tabName = tabs.find((tab) => tab.id === place)?.name ?? null;

  return (
    <>
      <TextField
        name="name"
        label="Name"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        inputRef={nameRef}
        required
        fullWidth
        error={!!nameError}
        helperText={nameError ?? `Address: ${pagePath(folderName, tabName, name.trim())}`}
        slotProps={{
          htmlInput: {
            maxLength: NAME_MAX_LENGTH,
            spellCheck: false,
            autoCapitalize: "none",
            readOnly: locked,
          },
          formHelperText: { sx: { overflowWrap: "anywhere" } },
        }}
      />
      <FormControl disabled={locked}>
        <FormLabel id={placeLabelId}>Place</FormLabel>
        <RadioGroup
          name={PLACE_FIELD}
          value={place}
          onChange={(event) => onPlaceChange(event.target.value)}
          aria-labelledby={placeLabelId}
        >
          <FormControlLabel value={FOLDER_TARGET} control={<Radio />} label="Directly in the folder" />
          {tabs.map((tab) => (
            <FormControlLabel
              key={tab.id}
              value={tab.id}
              control={<Radio />}
              label={`Tab ${tab.name}`}
              sx={{ overflowWrap: "anywhere" }}
            />
          ))}
        </RadioGroup>
      </FormControl>
    </>
  );
}
