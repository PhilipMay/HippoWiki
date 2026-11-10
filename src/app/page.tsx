import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import { siteDescription, siteName } from "@/lib/site";

export default function Home() {
  return (
    <Paper variant="outlined" sx={{ p: 4 }}>
      <Typography variant="h3" component="h1" gutterBottom>
        {siteName}
      </Typography>
      <Typography variant="body1" color="text.secondary">
        {siteDescription}
      </Typography>
    </Paper>
  );
}
