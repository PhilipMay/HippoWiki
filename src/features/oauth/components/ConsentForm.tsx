"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import MuiLink from "@mui/material/Link";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import { useId, useRef, useState, useTransition } from "react";

import Link from "@/components/Link";
import { LIFETIME_FIELD, type ConsentFormAction, type ConsentFormState } from "@/features/oauth/forms";
import { AUTHORIZATION_PARAMS, type AuthorizationParams } from "@/features/oauth/schema";
import { DEFAULT_TOKEN_EXPIRY, TOKEN_EXPIRIES, TOKEN_EXPIRY_DAYS } from "@/features/tokens/schema";
import { accountPath } from "@/lib/addresses";
import { useHydrated } from "@/lib/hydration";

type ConsentFormProps = {
  /** The parameters of the authorization request; the form submits them again, and the actions check them again. */
  params: AuthorizationParams;
  /** Whether the user holds the most tokens allowed: then there is nothing to approve. */
  limitReached: boolean;
  /** Server Action behind "Approve"; it returns the address of the app with the code, or the error to show. */
  approveAction: ConsentFormAction;
  /** Server Action behind "Deny"; it returns the address of the app with the refusal, or the error to show. */
  denyAction: ConsentFormAction;
};

/**
 * The form of the consent page: how long the app keeps its access, and "Approve" and "Deny". Both call their Server
 * Action and then open the address it returns, the redirect address of the app. A plain form could not do that: the
 * Content Security Policy keeps forms on this site (`form-action 'self'`), so the page needs JavaScript.
 */
export default function ConsentForm({ params, limitReached, approveAction, denyAction }: ConsentFormProps) {
  const [state, setState] = useState<ConsentFormState>({});
  const [lifetime, setLifetime] = useState<string>(DEFAULT_TOKEN_EXPIRY);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const lifetimeLabelId = useId();
  // A click before hydration would do nothing, so the choices and the buttons are disabled until then.
  const hydrated = useHydrated();
  // Once the answer is on its way to the app, nothing more can be chosen here.
  const leaving = state.redirectTo !== undefined;
  const locked = !hydrated || pending || leaving;

  const answer = (action: ConsentFormAction) => {
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    startTransition(async () => {
      const next = await action(formData);
      setState(next);
      // A full page load to the app; `assign` keeps the consent page in the history, as a redirect would not, but
      // the code it carried works only once.
      if (next.redirectTo !== undefined) window.location.assign(next.redirectTo);
    });
  };

  return (
    // The buttons call the actions themselves; the form only holds the fields. `onSubmit` keeps the Enter key from
    // submitting it to this page.
    <Stack component="form" ref={formRef} onSubmit={(event) => event.preventDefault()} noValidate spacing={3}>
      {AUTHORIZATION_PARAMS.map((name) =>
        params[name] === undefined ? null : <input key={name} type="hidden" name={name} value={params[name]} />,
      )}
      <noscript>
        <Alert severity="warning">This page needs JavaScript to send your answer to the app.</Alert>
      </noscript>
      {state.message && <Alert severity="error">{state.message}</Alert>}
      {leaving && <Alert severity="info">Returning to the app…</Alert>}
      {limitReached ? (
        <Alert severity="warning">
          You already have the most tokens allowed, so no further app can be connected. Revoke a token on your{" "}
          <MuiLink component={Link} href={accountPath()} color="inherit">
            account page
          </MuiLink>{" "}
          first, then connect again.
        </Alert>
      ) : (
        <FormControl>
          <FormLabel id={lifetimeLabelId}>Keep the access for</FormLabel>
          <RadioGroup
            aria-labelledby={lifetimeLabelId}
            name={LIFETIME_FIELD}
            value={lifetime}
            onChange={(event) => setLifetime(event.target.value)}
            row
          >
            {TOKEN_EXPIRIES.map((expiry) => (
              <FormControlLabel
                key={expiry}
                value={expiry}
                control={<Radio />}
                label={`${TOKEN_EXPIRY_DAYS[expiry]} days`}
                disabled={locked}
              />
            ))}
          </RadioGroup>
        </FormControl>
      )}
      <Stack direction="row" spacing={2}>
        {!limitReached && (
          <Button type="button" variant="contained" disabled={locked} onClick={() => answer(approveAction)}>
            Approve
          </Button>
        )}
        <Button type="button" variant="outlined" disabled={locked} onClick={() => answer(denyAction)}>
          Deny
        </Button>
      </Stack>
    </Stack>
  );
}
