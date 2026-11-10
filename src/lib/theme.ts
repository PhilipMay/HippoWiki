"use client";

import { createTheme } from "@mui/material/styles";

// The typography keeps Material UI's default font stack: Roboto is loaded with next/font in the root layout, and
// Material UI only applies its Roboto letter-spacing when the default stack is used.
export const theme = createTheme({
  cssVariables: true,
  palette: {
    primary: { main: "#3f51b5" },
    secondary: { main: "#00897b" },
    background: { default: "#f7f8fa" },
  },
  shape: { borderRadius: 8 },
});
