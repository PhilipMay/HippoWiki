// Two rules that every form with a Server Action follows, written once: the submission of a form with controlled
// choices, and the focus after a submission that the server refused (see "UI" in `architecture.md`). Hooks of the
// browser; no server-only imports.

import { startTransition, useEffect, useEffectEvent, type RefObject, type SubmitEvent } from "react";

/**
 * The `onSubmit` handler of a form that calls its Server Action itself, in a transition, instead of passing it as the
 * form's `action`: React resets a form after its action, and that reset puts controlled radio buttons, checkboxes and
 * selects back to their initial state, out of sync with the controlled one.
 */
export function useSubmitInTransition(formAction: (formData: FormData) => void) {
  return (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };
}

/**
 * Focuses the first of the fields, in the given order, that the state of the form names with an error. Field errors
 * come back from the Server Action, not from a client event, so the focus moves once the new state arrives. Each
 * submission returns a new state object, so a repeated rejection moves the focus again; the initial state and states
 * with only a message leave the focus where it is.
 */
export function useFocusOnFirstError<Field extends string>(
  state: { fieldErrors?: Partial<Record<Field, string[]>> },
  fields: readonly (readonly [Field, RefObject<HTMLElement | null>])[],
): void {
  // The fields are read when the state changes, not followed themselves: the list is new in every render.
  const focusFirstError = useEffectEvent((fieldErrors: Partial<Record<Field, string[]>> | undefined) => {
    const ref = fields.find(([field]) => fieldErrors?.[field])?.[1];
    ref?.current?.focus();
  });
  useEffect(() => focusFirstError(state.fieldErrors), [state]);
}
