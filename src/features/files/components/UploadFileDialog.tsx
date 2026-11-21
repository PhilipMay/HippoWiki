"use client";

// The dialog "Upload file" of a folder or a tab (`?action=upload`). It asks the server with a Server Action whether
// the name is taken at the place before it sends the file, so that an upload under a taken name first asks whether to
// store a new version of that file. The file itself is sent with `fetch()` as the body of a `POST` to the upload
// address, which a Server Action could not take beyond its body limit; the dialog then leads to the details page.

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type ChangeEvent, type SubmitEvent } from "react";

import ActionDialog, { DialogCancel } from "@/components/ActionDialog";
import Time from "@/components/Time";
import { suggestFileName } from "@/features/files/derive";
import type { NameCheck, UploadAnswer, UploadedFileState } from "@/features/files/forms";
import { editorWithChannel } from "@/features/users/records";
import { uploadPath } from "@/lib/addresses";
import { formatBytes } from "@/lib/format";
import { useHydrated } from "@/lib/hydration";

/** What the file field accepts: the extensions and MIME types of the five types, `.jpeg` included. */
const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,image/png,image/jpeg,image/gif,image/webp,application/pdf";

/** The message of an upload whose answer could not be read, such as a failure of the network. */
const UPLOAD_FAILED_MESSAGE = "The file could not be uploaded. Please try again.";

type UploadFileDialogProps = {
  /** The name of the folder and of the tab, or `null`, that the file is uploaded into. */
  folderName: string;
  tabName: string | null;
  /** The name the address presets (`&name=`), instead of the one the chosen file suggests. */
  presetName: string | null;
  /** The size limit of the server in bytes, so that a larger file is refused before it is sent. */
  sizeLimit: number;
  /** The Server Action that checks the name at the place, bound to the place. */
  checkName: (name: string) => Promise<NameCheck>;
  /** Where closing the dialog leads: the address without the action. */
  closeHref: string;
};

/** The errors of the dialog: at the file field, at the name field, and above the fields. */
type Errors = { file?: string; name?: string; message?: string };

/** The question whether to store a new version of the file of the name, with the file as it is now. */
type Question = { file: UploadedFileState; message?: string };

/** Whether the name ends in the extension of a PDF, for which there is no metadata to remove. */
function isPdfName(name: string): boolean {
  return name.trim().toLowerCase().endsWith(".pdf");
}

/** The dialog "Upload file": the file, its name, the option to remove the metadata of a photo, and "Upload". */
export default function UploadFileDialog({
  folderName,
  tabName,
  presetName,
  sizeLimit,
  checkName,
  closeHref,
}: UploadFileDialogProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const formId = useId();
  const fileFieldId = useId();
  const fileErrorId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(presetName ?? "");
  // A name the user typed, or the preset one, is kept when another file is chosen.
  const [nameEdited, setNameEdited] = useState(presetName !== null);
  const [strip, setStrip] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [question, setQuestion] = useState<Question | null>(null);
  const [pending, setPending] = useState(false);

  const offerStrip = !isPdfName(name) && !(file?.type === "application/pdf");

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setErrors((current) => ({ ...current, file: undefined }));
    if (chosen && !nameEdited) setName(suggestFileName(chosen.name));
  };

  /** Sends the file, as a new file or, with the lock version it is based on, as a new version of the file of the name. */
  const upload = async (chosen: File, replace?: number) => {
    setPending(true);
    let answer: UploadAnswer | null = null;
    try {
      const response = await fetch(
        uploadPath(folderName, tabName, name.trim(), { keepMetadata: offerStrip && !strip, replace }),
        { method: "POST", body: chosen, headers: { "Content-Type": "application/octet-stream" } },
      );
      answer = (await response.json()) as UploadAnswer;
    } catch {
      answer = null;
    }
    if (answer?.ok) {
      // The dialog stays open, with the button pending, until the details page has loaded.
      router.push(answer.address);
      return;
    }
    setPending(false);
    if (!answer) {
      setErrors({ message: UPLOAD_FAILED_MESSAGE });
      return;
    }
    if ((answer.code === "name-taken" || answer.code === "file-changed") && answer.file) {
      setErrors({});
      setQuestion({ file: answer.file, message: answer.code === "file-changed" ? answer.message : undefined });
      return;
    }
    setQuestion(null);
    if (answer.field === "name") setErrors({ name: answer.message });
    else if (answer.field === "file") setErrors({ file: answer.message });
    else setErrors({ message: answer.message });
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (!file) {
      setErrors({ file: "Choose a file" });
      fileRef.current?.focus();
      return;
    }
    if (file.size > sizeLimit) {
      setErrors({ file: `The file is larger than ${formatBytes(sizeLimit)}, the limit.` });
      return;
    }
    setPending(true);
    let check: NameCheck;
    try {
      check = await checkName(name.trim());
    } catch {
      setPending(false);
      setErrors({ message: UPLOAD_FAILED_MESSAGE });
      return;
    }
    if (!check.ok) {
      setPending(false);
      setErrors(check.field === "name" ? { name: check.message } : { message: check.message });
      return;
    }
    if (check.file) {
      setPending(false);
      setErrors({});
      setQuestion({ file: check.file });
      return;
    }
    await upload(file);
  };

  const confirmNewVersion = () => {
    if (file && question) void upload(file, question.file.lockVersion);
  };

  if (question) {
    return (
      <ActionDialog title="Upload file" closeHref={closeHref} pending={pending}>
        <DialogContent>
          <Stack spacing={2}>
            {question.message && <Alert severity="warning">{question.message}</Alert>}
            {errors.message && <Alert severity="error">{errors.message}</Alert>}
            <DialogContentText sx={{ overflowWrap: "anywhere" }}>
              A file named {name.trim()} exists here already, last changed{" "}
              <Time date={new Date(question.file.updatedAt)} /> by {editorWithChannel(question.file.lastEditedBy)}.
              Store the chosen file as a new version of it? Its earlier versions are kept.
            </DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions>
          <DialogCancel href={closeHref} pending={pending} />
          <Button variant="contained" disabled={pending || !hydrated} onClick={confirmNewVersion}>
            {pending ? "Uploading…" : "Upload new version"}
          </Button>
        </DialogActions>
      </ActionDialog>
    );
  }

  return (
    <ActionDialog title="Upload file" closeHref={closeHref} pending={pending} focusRef={fileRef}>
      <DialogContent>
        <Box component="form" id={formId} onSubmit={(event) => void submit(event)} noValidate>
          <Stack spacing={3} useFlexGap sx={{ pt: 1 }}>
            {errors.message && <Alert severity="error">{errors.message}</Alert>}
            <Stack spacing={0.5}>
              <Typography component="label" htmlFor={fileFieldId} variant="body2">
                File *
              </Typography>
              <input
                ref={fileRef}
                id={fileFieldId}
                type="file"
                name="file"
                accept={ACCEPT}
                required
                disabled={!hydrated || pending}
                aria-invalid={errors.file !== undefined}
                aria-describedby={errors.file ? fileErrorId : undefined}
                onChange={chooseFile}
              />
              <FormHelperText id={fileErrorId} error={errors.file !== undefined}>
                {errors.file ?? `PNG, JPEG, GIF, WebP or PDF, at most ${formatBytes(sizeLimit)}`}
              </FormHelperText>
            </Stack>
            <TextField
              label="Name"
              name="name"
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameEdited(true);
                setErrors((current) => ({ ...current, name: undefined }));
              }}
              error={errors.name !== undefined}
              helperText={errors.name ?? "Lowercase letters, digits and hyphens, then the extension, e.g. diagram.png"}
              slotProps={{ htmlInput: { readOnly: !hydrated || pending, spellCheck: false } }}
            />
            {offerStrip && (
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
