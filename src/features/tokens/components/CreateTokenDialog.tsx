"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type SubmitEvent } from "react";

import Link from "@/components/Link";
import { TOKEN_FIELDS, type CreateTokenFormAction } from "@/features/tokens/forms";
import {
  DEFAULT_TOKEN_EXPIRY,
  DEFAULT_TOKEN_SCOPES,
  TOKEN_EXPIRIES,
  TOKEN_EXPIRY_DAYS,
  TOKEN_NAME_MAX_LENGTH,
  TOKEN_SCOPES,
  type TokenScope,
} from "@/features/tokens/schema";
import { focusOnEntered } from "@/lib/focus";
import { useHydrated } from "@/lib/hydration";

/** What each scope allows, next to its checkbox. */
const SCOPE_DESCRIPTIONS: Record<TokenScope, string> = {
  read: "read the wiki",
  write: "change the wiki; does not include read",
};

type CreateTokenDialogProps = {
  /** Server Action that creates the token; it returns the errors to show, or the created token. */
  action: CreateTokenFormAction;
  /** Where the dialog leads when it is closed: the account. */
  closeHref: string;
};

/**
 * The "New token" dialog. First it asks for the name, the scopes and the expiry. After the creation it shows, in place
 * of the form, the token with a copy button. The token is shown only this once: it lives in the state of this dialog
 * and nowhere else in the browser.
 */
export default function CreateTokenDialog({ action, closeHref }: CreateTokenDialogProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // Controlled fields keep the input when the action returns errors.
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<readonly TokenScope[]>(DEFAULT_TOKEN_SCOPES);
  const [expiry, setExpiry] = useState<string>(DEFAULT_TOKEN_EXPIRY);
  /** Whether the token was copied: not yet, done, or the browser refused. */
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const nameRef = useRef<HTMLInputElement>(null);
  const scopeRef = useRef<HTMLInputElement>(null);
  const expiryRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const titleId = useId();
  const formId = useId();
  const scopesLabelId = useId();
  const expiryLabelId = useId();
  // The dialog is part of the server-rendered page. Input before hydration could be lost, so the name is read-only and
  // the choices and "Create" are disabled until then.
  const hydrated = useHydrated();

  const created = state.created;
  const nameError = state.fieldErrors?.name?.[0];
  const scopesError = state.fieldErrors?.scopes?.[0];
  const expiryError = state.fieldErrors?.expiry?.[0];

  // Field errors come back from the Server Action, so the focus moves once the new state arrives, to the first field
  // with an error. The created token is selected, ready to be copied by hand as well.
  useEffect(() => {
    if (state.created) secretRef.current?.select();
    else if (state.fieldErrors?.name) nameRef.current?.focus();
    else if (state.fieldErrors?.scopes) scopeRef.current?.focus();
    else if (state.fieldErrors?.expiry) expiryRef.current?.focus();
  }, [state]);

  // The form calls the action itself instead of passing it as the form's `action`: React resets a form after its
  // action, and that reset puts the checkboxes and radio buttons back to their initial state, out of sync with the
  // controlled one.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  const toggleScope = (scope: TokenScope, checked: boolean) => {
    setScopes((current) => TOKEN_SCOPES.filter((each) => (each === scope ? checked : current.includes(each))));
  };

  const close = () => {
    if (!pending) router.push(closeHref);
  };

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopy("copied");
    } catch {
      // E.g. the browser does not allow scripts to write to the clipboard; the token can still be copied by hand.
      setCopy("failed");
    }
  };

  return (
    <Dialog
      open
      // Once the token is shown, the dialog closes only through its link: a click next to it or the Escape key must
      // not throw away a token that cannot be shown again.
      onClose={created ? undefined : close}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
      // Without a portal the dialog is in the server-rendered HTML, like the rest of the page.
      disablePortal
      slotProps={{ transition: { onEntered: (node) => focusOnEntered(node, nameRef.current) } }}
    >
      <DialogTitle id={titleId}>{created ? "Token created" : "New token"}</DialogTitle>
      {created ? (
        <>
          <DialogContent>
            <Stack spacing={3} sx={{ pt: 1 }}>
              <Typography sx={{ overflowWrap: "anywhere" }}>
                The token <strong>{created.name}</strong> was created. Copy it into the script or tool that is to use
                it.
              </Typography>
              <TextField
                label="Token"
                value={created.secret}
                fullWidth
                inputRef={secretRef}
                slotProps={{
                  htmlInput: { readOnly: true, spellCheck: false },
                  input: { sx: { fontFamily: "monospace" } },
                }}
              />
              <Alert severity="warning">
                The token is shown only this once. It cannot be shown again after you leave this dialog.
              </Alert>
              {copy === "failed" && (
                <Alert severity="error">The token could not be copied. Select it and copy it yourself.</Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            {/* `void`: the handler does not wait for the clipboard; `copySecret` reports its outcome in the state. */}
            <Button onClick={() => void copySecret(created.secret)}>
              {copy === "copied" ? "Copied" : "Copy token"}
            </Button>
            <Button component={Link} href={closeHref} variant="contained">
              Back to the account
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogContent>
            {/* `noValidate`: the server validates, and its errors are shown at the fields. */}
            <Box component="form" id={formId} onSubmit={submit} noValidate>
              <Stack spacing={3} sx={{ pt: 1 }}>
                {state.message && <Alert severity="error">{state.message}</Alert>}
                <TextField
                  name={TOKEN_FIELDS.name}
                  label="Name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  inputRef={nameRef}
                  required
                  fullWidth
                  error={!!nameError}
                  helperText={
                    nameError ??
                    `Up to ${TOKEN_NAME_MAX_LENGTH} characters, e.g. the tool or the machine that uses the token.`
                  }
                  slotProps={{
                    htmlInput: { maxLength: TOKEN_NAME_MAX_LENGTH, autoComplete: "off", readOnly: !hydrated },
                  }}
                />
                <FormControl component="fieldset" error={!!scopesError} required>
                  <FormLabel component="legend" id={scopesLabelId}>
                    Scopes
                  </FormLabel>
                  <FormGroup aria-labelledby={scopesLabelId}>
                    {TOKEN_SCOPES.map((scope, index) => (
                      <FormControlLabel
                        key={scope}
                        label={`${scope}: ${SCOPE_DESCRIPTIONS[scope]}`}
                        control={
                          <Checkbox
                            name={TOKEN_FIELDS.scopes}
                            value={scope}
                            checked={scopes.includes(scope)}
                            onChange={(event) => toggleScope(scope, event.target.checked)}
                            slotProps={{ input: { ref: index === 0 ? scopeRef : undefined } }}
                            disabled={!hydrated}
                          />
                        }
                      />
                    ))}
                  </FormGroup>
                  {scopesError && <FormHelperText>{scopesError}</FormHelperText>}
                </FormControl>
                <FormControl component="fieldset" error={!!expiryError} required>
                  <FormLabel component="legend" id={expiryLabelId}>
                    Expires after
                  </FormLabel>
                  <RadioGroup
                    name={TOKEN_FIELDS.expiry}
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value)}
                    aria-labelledby={expiryLabelId}
                    row
                  >
                    {TOKEN_EXPIRIES.map((choice, index) => (
                      <FormControlLabel
                        key={choice}
                        value={choice}
                        label={`${TOKEN_EXPIRY_DAYS[choice]} days`}
                        control={
                          <Radio
                            slotProps={{ input: { ref: index === 0 ? expiryRef : undefined } }}
                            disabled={!hydrated}
                          />
                        }
                      />
                    ))}
                  </RadioGroup>
                  {expiryError && <FormHelperText>{expiryError}</FormHelperText>}
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
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
