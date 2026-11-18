import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

type EmptyStateProps = {
  /** What is missing, as a heading, e.g. "No pages yet"; without it the text stands alone in one short sentence. */
  title?: string;
  /** What the user can do about it, or what will be listed. */
  text: string;
};

/** What a list shows in place of its items when it has none. */
export default function EmptyState({ title, text }: EmptyStateProps) {
  if (title === undefined) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography color="text.secondary">{text}</Typography>
      </Paper>
    );
  }
  return (
    <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
      <Typography variant="h6" component="p" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
    </Paper>
  );
}
