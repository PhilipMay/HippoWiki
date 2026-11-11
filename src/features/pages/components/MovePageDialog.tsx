"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type SubmitEvent } from "react";

import Link from "@/components/Link";
import { MOVE_TARGET_FIELD, type PageMoveFormAction } from "@/features/pages/schema";
import { useHydrated } from "@/lib/hydration";

/** The value of the choice "directly in the folder": no tab. */
const FOLDER_TARGET = "";

type MovePageDialogProps = {
  /** Server Action that moves the page; it returns the errors to show, or redirects on success. */
  action: PageMoveFormAction;
  /** The tabs of the page's folder, in display order. */
  tabs: { id: string; name: string }[];
  /** The id of the tab the page lives in, or `null` for a page placed directly in its folder. */
  currentTabId: string | null;
  /** The page address without the action, where closing the dialog leads. */
  closeHref: string;
};

/**
 * Dialog "Move page" with a choice of the folder itself and its tabs; the current place of the page is preselected.
 * The route renders it for `?action=move`, so it is open from the start; closing it leads to the page address.
 */
export default function MovePageDialog({ action, tabs, currentTabId, closeHref }: MovePageDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // A controlled choice keeps the selection when the action returns errors.
  const [target, setTarget] = useState(currentTabId ?? FOLDER_TARGET);
  const groupRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const titleId = useId();
  const formId = useId();
  const labelId = useId();
  const errorId = useId();
  // The dialog is part of the server-rendered page. A choice made before hydration could be lost, so the choices and
  // "Save" are disabled until then.
  const hydrated = useHydrated();

  const targetError = state.fieldErrors?.target?.[0];

  const focusChoice = () => groupRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();

  // The error comes back from the Server Action, so the focus moves to the choice once the new state arrives.
  useEffect(() => {
    if (state.fieldErrors?.target) focusChoice();
  }, [state]);

  // The form calls the action itself instead of passing it as the form's `action`: React resets a form after its
  // action, and that reset puts the radio buttons back to the initial choice, out of sync with the controlled one.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  const close = () => {
    if (!pending) router.push(closeHref);
  };

  return (
    <Dialog
      open
      onClose={close}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
      // Without a portal the dialog is in the server-rendered HTML, like the rest of the page.
      disablePortal
      // The dialog focuses itself on opening, so the selected choice is focused once the dialog has entered.
      slotProps={{ transition: { onEntered: focusChoice } }}
    >
      <DialogTitle id={titleId}>Move page</DialogTitle>
      <DialogContent>
        <Box component="form" id={formId} onSubmit={submit} noValidate>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {state.message && <Alert severity="error">{state.message}</Alert>}
            <FormControl error={!!targetError} disabled={!hydrated}>
              <FormLabel id={labelId}>Move to</FormLabel>
              <RadioGroup
                ref={groupRef}
                name={MOVE_TARGET_FIELD}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                aria-labelledby={labelId}
                aria-describedby={targetError ? errorId : undefined}
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
              {targetError && <FormHelperText id={errorId}>{targetError}</FormHelperText>}
            </FormControl>
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button component={Link} href={closeHref} disabled={pending}>
          Cancel
        </Button>
        {/* Outside the form element, so it is tied to the form by its id. */}
        <Button type="submit" form={formId} variant="contained" disabled={pending || !hydrated}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
