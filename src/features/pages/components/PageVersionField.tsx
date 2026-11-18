import Alert from "@mui/material/Alert";

import { VERSION_FIELD } from "@/features/pages/fields";

type PageVersionFieldProps = {
  /** The version of the page the form was rendered with, which the change is based on. */
  version: number;
  /** The message that the page was changed after the form was opened, after a refused change (see `changedPageForm`). */
  changedMessage?: string;
};

/**
 * What every form that rests on the version of a page holds: the version in a hidden field, without which every change
 * is refused as changed, and the warning after a refused change.
 */
export default function PageVersionField({ version, changedMessage }: PageVersionFieldProps) {
  return (
    <>
      <input type="hidden" name={VERSION_FIELD} value={version} />
      {changedMessage && <Alert severity="warning">{changedMessage}</Alert>}
    </>
  );
}
