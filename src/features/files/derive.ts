// The name that the name of an uploaded file suggests for it in the upload dialog. A pure module, so that the dialog
// can use it in the browser.

import { deriveName } from "@/lib/derive-name";
import { FILE_EXTENSIONS, type FileExtension } from "@/lib/name-limits";

/** Whether the text is the extension of a type of file. */
function isFileExtension(text: string): text is FileExtension {
  return (FILE_EXTENSIONS as readonly string[]).includes(text);
}

/**
 * The name that the name of an uploaded file suggests: its part before the last dot by the rule that suggests page
 * names (`deriveName()`), a dot and its extension in lower case, `.jpeg` as `.jpg`. `Network Diagram (v2).PNG` gives
 * `network-diagram-v2.png` and `photo.jpeg` `photo.jpg`. Without the extension of an accepted type the suggestion is the
 * name alone, and without a usable name it is empty: the user then types the name.
 */
export function suggestFileName(uploadedName: string): string {
  const dot = uploadedName.lastIndexOf(".");
  const base = deriveName(dot < 0 ? uploadedName : uploadedName.slice(0, dot));
  if (base === "") return "";
  const extension = dot < 0 ? "" : uploadedName.slice(dot + 1).toLowerCase();
  const fixed = extension === "jpeg" ? "jpg" : extension;
  return isFileExtension(fixed) ? `${base}.${fixed}` : base;
}
