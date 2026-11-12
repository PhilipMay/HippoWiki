"use client";

import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import TextField from "@mui/material/TextField";
import { useId, type Ref } from "react";

import { PLACE_FIELD } from "@/features/pages/forms";
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
  /**
   * The chosen place: the id of a tab, `FOLDER_TARGET` for the folder itself, or `null` when no place is chosen yet. Then
   * no place is checked and the address is not shown.
   */
  place: string | null;
  onPlaceChange: (place: string) => void;
  /** The error to show at the name field, if any. */
  nameError?: string;
  /** Ref to the name input, for moving the focus to it. */
  nameRef: Ref<HTMLInputElement>;
  /** The error to show at the place field, if any. */
  placeError?: string;
  /** Ref to the input of the first place, for moving the focus to the place field. */
  placeRef?: Ref<HTMLInputElement>;
  /**
   * Makes the name read-only and disables the places, for dialogs that render before hydration, when input could be
   * lost.
   */
  locked: boolean;
};

/**
 * The name field of a page, with the address it gets below it, and the choice of its place: directly in the folder or
 * one of its tabs. Shared by the "Save page", the "Move or rename page" and the "Restore page" dialog; the dialog keeps
 * name and place in its state.
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
  placeError,
  placeRef,
  locked,
}: PageNameAndPlaceFieldsProps) {
  const placeLabelId = useId();
  const placeErrorId = useId();
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
        helperText={
          nameError ?? (place === null ? undefined : `Address: ${pagePath(folderName, tabName, name.trim())}`)
        }
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
      <FormControl disabled={locked} error={!!placeError}>
        <FormLabel id={placeLabelId}>Place</FormLabel>
        <RadioGroup
          name={PLACE_FIELD}
          // `null` keeps the group controlled with no place checked.
          value={place}
          onChange={(event) => onPlaceChange(event.target.value)}
          aria-labelledby={placeLabelId}
          aria-describedby={placeError ? placeErrorId : undefined}
        >
          <FormControlLabel
            value={FOLDER_TARGET}
            control={<Radio slotProps={{ input: { ref: placeRef } }} />}
            label="Directly in the folder"
          />
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
        {placeError && <FormHelperText id={placeErrorId}>{placeError}</FormHelperText>}
      </FormControl>
    </>
  );
}
