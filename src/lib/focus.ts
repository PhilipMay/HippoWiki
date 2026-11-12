/**
 * Moves the focus to `target` once a Material UI dialog has entered, unless the focus has moved to an element inside the
 * dialog since the dialog focused itself on opening. That happens when the user clicks a control while the dialog is
 * still fading in, or when a Server Action returns field errors before the dialog has entered and the dialog focuses the
 * first field with an error; the entered dialog must not take that focus away.
 *
 * `node` is the node the dialog's transition passes to `onEntered`. It contains the element with the role `dialog`,
 * which the dialog focuses on opening.
 */
export function focusOnEntered(node: HTMLElement, target: HTMLElement | null): void {
  const dialog = node.querySelector('[role="dialog"]');
  const active = node.ownerDocument.activeElement;
  if (dialog && active && active !== dialog && dialog.contains(active)) return;
  target?.focus();
}
