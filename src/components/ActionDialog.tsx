"use client";

// The frame of a dialog that a route renders for an action and that submits a form, written once with its rules (see
// "UI" in `architecture.md`): it is open from the start and part of the server-rendered HTML, closing it leads to the
// address without the action, it does not close while the submission runs, "Cancel" is a link, and the submit button
// stays disabled until hydration. The dialogs keep the body of their forms and their texts.

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import { useRouter } from "next/navigation";
import { useId, type ReactNode, type RefObject, type SubmitEvent } from "react";

import Link from "@/components/Link";
import { focusOnEntered } from "@/lib/focus";
import { useHydrated } from "@/lib/hydration";

type ActionDialogProps = {
  title: string;
  /** Where closing the dialog leads: the address without the action. */
  closeHref: string;
  /** Whether the submission runs: the dialog does not close until it is done. */
  pending: boolean;
  /**
   * Whether the Escape key and a click next to the dialog close it. `false` where closing would throw away something
   * that cannot be shown again; the dialog then closes only through a link.
   */
  closable?: boolean;
  /** The id of the element that describes the dialog, such as the sentence of a confirmation. */
  describedBy?: string;
  /**
   * The field to focus once the dialog has entered. `autoFocus` does not hold in a dialog, because the dialog focuses
   * itself on opening; the field is focused unless the focus has moved into the dialog by then (see `focusOnEntered`).
   */
  focusRef?: RefObject<HTMLElement | null>;
  /** The content and the actions of the dialog. */
  children: ReactNode;
};

/** A dialog of an action, open from the start, with its title. */
export default function ActionDialog({
  title,
  closeHref,
  pending,
  closable = true,
  describedBy,
  focusRef,
  children,
}: ActionDialogProps) {
  const router = useRouter();
  const titleId = useId();

  const close = () => {
    if (!pending) router.push(closeHref);
  };

  return (
    <Dialog
      open
      onClose={closable ? close : undefined}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      // Without a portal the dialog is in the server-rendered HTML, like the rest of the page.
      disablePortal
      slotProps={
        focusRef && { transition: { onEntered: (node: HTMLElement) => focusOnEntered(node, focusRef.current) } }
      }
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      {children}
    </Dialog>
  );
}

type DialogFormProps = {
  /** The id that ties the submit button outside the form to it. */
  id: string;
  /** The Server Action as the form's `action`, for a form without controlled choices. */
  action?: (formData: FormData) => void;
  /** The handler of a form that calls its Server Action itself (see `useSubmitInTransition`). */
  onSubmit?: (event: SubmitEvent<HTMLFormElement>) => void;
  /** The error of the last submission that is not about a single field. */
  message?: string;
  /** What the form shows above that error, such as the version of a page with its warning. */
  lead?: ReactNode;
  /** The fields of the form. */
  children: ReactNode;
};

/**
 * The content of a dialog with fields: the form, with the error of the form state above the fields. `noValidate`: the
 * server validates, and its errors are shown at the fields.
 */
export function DialogForm({ id, action, onSubmit, message, lead, children }: DialogFormProps) {
  return (
    <DialogContent>
      <Box component="form" id={id} action={action} onSubmit={onSubmit} noValidate>
        {/* Flex gaps, so that a hidden field of the form adds no space. */}
        <Stack spacing={3} useFlexGap sx={{ pt: 1 }}>
          {lead}
          {message && <Alert severity="error">{message}</Alert>}
          {children}
        </Stack>
      </Box>
    </DialogContent>
  );
}

type DialogCancelProps = {
  /** Where "Cancel" leads: the address without the action. */
  href: string;
  pending: boolean;
};

/** "Cancel" of a dialog: a link, so that it works without JavaScript as well, disabled while the submission runs. */
export function DialogCancel({ href, pending }: DialogCancelProps) {
  return (
    <Button component={Link} href={href} disabled={pending}>
      Cancel
    </Button>
  );
}

type DialogFormActionsProps = {
  /** Where "Cancel" leads: the address without the action. */
  closeHref: string;
  /** The id of the form the submit button submits. */
  formId: string;
  pending: boolean;
  /** The label of the submit button, e.g. "Save", and its label while the submission runs, e.g. "Saving…". */
  label: string;
  pendingLabel: string;
  /** The colour of the submit button: `error` for a delete. */
  color?: "primary" | "error";
  /** Whether the submission would change nothing, such as a rename to the current name. */
  disabled?: boolean;
};

/**
 * "Cancel" and the submit button of a dialog. The submit button is outside the form element and tied to it by its id.
 * It is the default button of the form, so while it is disabled Enter in a field submits nothing either: while the
 * submission runs, before hydration, when a click would do nothing, and for `disabled`.
 */
export function DialogFormActions({
  closeHref,
  formId,
  pending,
  label,
  pendingLabel,
  color = "primary",
  disabled = false,
}: DialogFormActionsProps) {
  const hydrated = useHydrated();

  return (
    <DialogActions>
      <DialogCancel href={closeHref} pending={pending} />
      <Button type="submit" form={formId} variant="contained" color={color} disabled={pending || !hydrated || disabled}>
        {pending ? pendingLabel : label}
      </Button>
    </DialogActions>
  );
}

type ConfirmDialogProps = {
  title: string;
  /** Where closing the dialog leads: the address without the action. */
  closeHref: string;
  /** The Server Action of the form, from `useActionState`. */
  formAction: (formData: FormData) => void;
  pending: boolean;
  /** The error of the last submission. */
  message?: string;
  /** The sentence that names what is confirmed and what follows from it. */
  description: ReactNode;
  /** What the form shows above the error, such as the version of a page with its warning. */
  lead?: ReactNode;
  /** The label of the submit button and its label while the submission runs. */
  label: string;
  pendingLabel: string;
  color?: "primary" | "error";
  /** The actions in place of "Cancel" and the submit button, e.g. once the item is gone. */
  actions?: ReactNode;
};

/** A dialog that asks to confirm an action, such as a delete or a revert, with a form without fields. */
export function ConfirmDialog({
  title,
  closeHref,
  formAction,
  pending,
  message,
  description,
  lead,
  label,
  pendingLabel,
  color,
  actions,
}: ConfirmDialogProps) {
  const descriptionId = useId();
  const formId = useId();

  return (
    <ActionDialog title={title} closeHref={closeHref} pending={pending} describedBy={descriptionId}>
      <DialogContent>
        <Box component="form" id={formId} action={formAction}>
          {/* Flex gaps, so that a hidden field of the form adds no space. */}
          <Stack spacing={3} useFlexGap>
            {lead}
            {message && <Alert severity="error">{message}</Alert>}
            <DialogContentText id={descriptionId} sx={{ overflowWrap: "anywhere" }}>
              {description}
            </DialogContentText>
          </Stack>
        </Box>
      </DialogContent>
      {actions ?? (
        <DialogFormActions
          closeHref={closeHref}
          formId={formId}
          pending={pending}
          label={label}
          pendingLabel={pendingLabel}
          color={color}
        />
      )}
    </ActionDialog>
  );
}
