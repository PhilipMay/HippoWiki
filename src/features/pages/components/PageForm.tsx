"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useActionState, useRef, useState } from "react";

import Link from "@/components/Link";
import MarkdownEditor from "@/features/pages/components/MarkdownEditor";
import PageVersionField from "@/features/pages/components/PageVersionField";
import type { PageFormAction } from "@/features/pages/forms";
import { useFocusOnFirstError } from "@/lib/form-hooks";

type PageFormProps = {
  /** Server Action that stores the content; it returns the errors to show, or redirects on success. */
  action: PageFormAction;
  /** The content the form starts with: the current content of the page. */
  initialContent: string;
  /** The version of the page the form was rendered with, which the save is based on. */
  version: number;
  /** The message that the page was changed after the form was opened, after a refused save. */
  changedMessage?: string;
  /** Where "Cancel" leads. */
  cancelHref: string;
};

/**
 * Form for the Markdown content of an existing page. The title is derived from the content's first heading when the
 * page is saved. The name is not part of the form; a page is moved or renamed in its own dialog. New pages use
 * `NewPageForm`.
 */
export default function PageForm({ action, initialContent, version, changedMessage, cancelHref }: PageFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  // The content is read-only and "Save" is disabled until the editor is ready, also after hydration.
  const [ready, setReady] = useState(false);

  const contentRef = useRef<HTMLElement>(null);

  const contentError = state.fieldErrors?.content?.[0];

  useFocusOnFirstError(state, [["content", contentRef]]);

  return (
    // `noValidate`: the server validates, and its errors are shown at the field instead of browser bubbles.
    <Stack component="form" action={formAction} noValidate spacing={3}>
      <PageVersionField version={version} changedMessage={changedMessage} />
      {state.message && <Alert severity="error">{state.message}</Alert>}
      {/* The editor keeps the entered content when the action returns errors; its hidden field is submitted. */}
      <MarkdownEditor
        initialContent={initialContent}
        newPage={false}
        error={contentError}
        contentRef={contentRef}
        onReady={() => setReady(true)}
      />
      <Stack direction="row" spacing={2}>
        <Button type="submit" variant="contained" disabled={pending || !ready}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button component={Link} href={cancelHref}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
}
