// The content limit of a page in the editor: the editor accepts no more than the limit, counted as the server
// counts the content, in code units with every line break as one character, which is the length of the document of
// CodeMirror.

import { EditorState, type ChangeSpec, type Extension } from "@codemirror/state";

import { CONTENT_MAX_LENGTH } from "@/features/pages/limits";

/** Whether the code unit at `index` of `text` is the second half of a surrogate pair. */
function isLowSurrogateAt(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  const before = text.charCodeAt(index - 1);
  return code >= 0xdc00 && code <= 0xdfff && before >= 0xd800 && before <= 0xdbff;
}

/** `text` cut to at most `length` code units, without splitting a surrogate pair. */
function cut(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length > 0 && isLowSurrogateAt(text, length) ? length - 1 : length);
}

/**
 * A transaction filter that keeps the document within `max` characters:
 * - A change that keeps the content within the limit, or that does not make it longer, passes, so content over a limit
 *   lowered later can still be opened and shortened.
 * - A paste that would go past the limit is cut to the characters that fit.
 * - Every other change that would go past it, such as a typed character, a toolbar button, Enter in a list or replace
 *   all, is not made at all.
 */
export function contentLimit(max: number = CONTENT_MAX_LENGTH): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    const before = tr.startState.doc.length;
    const after = tr.newDoc.length;
    if (after <= max || after <= before) return tr;
    if (!tr.isUserEvent("input.paste")) return [];

    // The removed text frees room for the pasted text; the pasted pieces are cut in order until the room is used up.
    let room = max - before;
    tr.changes.iterChangedRanges((fromA, toA) => (room += toA - fromA));
    const changes: ChangeSpec[] = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const insert = cut(inserted.toString(), Math.max(0, room));
      room -= insert.length;
      changes.push({ from: fromA, to: toA, insert });
    });
    const changeSet = tr.startState.changes(changes);
    return {
      changes: changeSet,
      selection: tr.startState.selection.map(changeSet, 1),
      scrollIntoView: true,
      userEvent: "input.paste",
    };
  });
}
