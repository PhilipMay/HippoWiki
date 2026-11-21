"use client";

// The dialog "Upload new version" of the details page of a file (`?action=upload-version`). It sends the chosen file
// with `fetch()` as the body of a `POST` to the upload address of the file, with the lock version the dialog was opened
// with. When the file was changed meanwhile, the dialog shows who changed it and stays open with the chosen file and the
// lock version of the file as it is now, so that confirming again stores it.

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type SubmitEvent } from "react";

import ActionDialog, { DialogCancel } from "@/components/ActionDialog";
import type { UploadAnswer } from "@/features/files/forms";
import { changedMessage } from "@/features/pages/changed-page";
import { uploadPath } from "@/lib/addresses";
import { formatBytes } from "@/lib/format";
import { useHydrated } from "@/lib/hydration";

/** The message of an upload whose answer could not be read, such as a failure of the network. */
const UPLOAD_FAILED_MESSAGE = "The file could not be uploaded. Please try again.";

type UploadVersionDialogProps = {
  /** The name of the folder, of the tab or `null`, and of the file, which the new version keeps. */
  folderName: string;
  tabName: string | null;
  fileName: string;
  /** The type of the file as the views name it, e.g. "PNG", and what the file field accepts of it. */
  typeLabel: string;
  accept: string;
  /** Whether the file is an image, whose metadata the dialog offers to remove. */
  image: boolean;
  /** The lock version of the file the dialog was rendered with, which the new version is based on. */
  lockVersion: number;
  /** The size limit of the server in bytes, so that a larger file is refused before it is sent. */
  sizeLimit: number;
  /** The details page of the file, where closing the dialog leads. */
  closeHref: string;
};

/** The dialog "Upload new version": the file, the option to remove the metadata of a photo, and "Upload". */
export default function UploadVersionDialog({
  folderName,
  tabName,
  fileName,
  typeLabel,
  accept,
  image,
  lockVersion: openedWith,
  sizeLimit,
  closeHref,
}: UploadVersionDialogProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const formId = useId();
  const fileFieldId = useId();
  const fileErrorId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [strip, setStrip] = useState(true);
  const [lockVersion, setLockVersion] = useState(openedWith);
  const [fileError, setFileError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [changed, setChanged] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (!file) {
      setFileError("Choose a file");
      fileRef.current?.focus();
      return;
    }
    if (file.size > sizeLimit) {
      setFileError(`The file is larger than ${formatBytes(sizeLimit)}, the limit.`);
      return;
    }
    setPending(true);
    let answer: UploadAnswer | null = null;
    try {
      const response = await fetch(
        uploadPath(folderName, tabName, fileName, { keepMetadata: image && !strip, replace: lockVersion }),
        { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } },
      );
      answer = (await response.json()) as UploadAnswer;
    } catch {
      answer = null;
    }
    if (answer?.ok) {
      // The dialog stays open, with the button pending, until the details page has loaded.
      router.push(answer.address);
      router.refresh();
      return;
    }
    setPending(false);
    setFileError(undefined);
    setMessage(undefined);
    if (!answer) {
      setMessage(UPLOAD_FAILED_MESSAGE);
    } else if (answer.code === "file-changed" && answer.file) {
      setLockVersion(answer.file.lockVersion);
      setChanged(changedMessage({ ...answer.file, updatedAt: new Date(answer.file.updatedAt) }, "file"));
    } else if (answer.field === "file") {
      setFileError(answer.message);
    } else {
      setMessage(answer.message);
    }
  };

  return (
    <ActionDialog title="Upload new version" closeHref={closeHref} pending={pending} focusRef={fileRef}>
      <DialogContent>
        <Box component="form" id={formId} onSubmit={(event) => void submit(event)} noValidate>
          <Stack spacing={3} useFlexGap sx={{ pt: 1 }}>
            {changed && <Alert severity="warning">{changed}</Alert>}
            {message && <Alert severity="error">{message}</Alert>}
            <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
              The chosen file becomes the newest version of {fileName}; its earlier versions are kept.
            </Typography>
            <Stack spacing={0.5}>
              <Typography component="label" htmlFor={fileFieldId} variant="body2">
                File *
              </Typography>
              <input
                ref={fileRef}
                id={fileFieldId}
                type="file"
                name="file"
                accept={accept}
                required
                disabled={!hydrated || pending}
                aria-invalid={fileError !== undefined}
                aria-describedby={fileErrorId}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setFileError(undefined);
                }}
              />
              <FormHelperText id={fileErrorId} error={fileError !== undefined}>
                {fileError ?? `A ${typeLabel} file, at most ${formatBytes(sizeLimit)}`}
              </FormHelperText>
            </Stack>
            {image && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={strip}
                    onChange={(event) => setStrip(event.target.checked)}
                    disabled={!hydrated || pending}
                  />
                }
                label="Remove location and camera data"
              />
            )}
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <DialogCancel href={closeHref} pending={pending} />
        <Button type="submit" form={formId} variant="contained" disabled={pending || !hydrated}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </DialogActions>
    </ActionDialog>
  );
}
