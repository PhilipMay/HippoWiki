import Typography from "@mui/material/Typography";

import Time from "@/components/Time";
import type { RevisionSummary } from "@/features/pages/history-service";
import { editorWithChannel } from "@/features/users/records";

type RevisionLineProps = {
  revision: RevisionSummary;
  /** The number of the newest revision of the page. */
  newest: number;
};

/**
 * The revision line: "Revision 5 of 12 · <time> by mike via mcp", with "Reverted to revision N" for a revision that a
 * revert recorded.
 */
export default function RevisionLine({ revision, newest }: RevisionLineProps) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
      Revision {revision.number} of {newest} · <Time date={revision.createdAt} /> by{" "}
      {editorWithChannel(revision.madeBy)}
      {revision.revertedTo !== null && ` · Reverted to revision ${revision.revertedTo}`}
    </Typography>
  );
}
