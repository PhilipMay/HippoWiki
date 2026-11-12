import { describe, expect, it, vi } from "vitest";

import { focusOnEntered } from "@/lib/focus";

const dialog = { contains: (element: unknown) => element === dialog || element === field };
const field = {};

/** A transition node that contains `dialog` (with `field` inside it) and whose document has `active` focused. */
function fakeNode(active: unknown) {
  return {
    ownerDocument: { activeElement: active },
    querySelector: (selector: string) => (selector === '[role="dialog"]' ? dialog : null),
  } as unknown as HTMLElement;
}

function fakeTarget() {
  return { focus: vi.fn() };
}

describe("focusOnEntered", () => {
  it("focuses the target while the dialog itself has the focus", () => {
    const target = fakeTarget();

    focusOnEntered(fakeNode(dialog), target as unknown as HTMLElement);

    expect(target.focus).toHaveBeenCalledOnce();
  });

  it("focuses the target when the focus is outside the dialog or nowhere", () => {
    for (const active of [{}, null]) {
      const target = fakeTarget();

      focusOnEntered(fakeNode(active), target as unknown as HTMLElement);

      expect(target.focus).toHaveBeenCalledOnce();
    }
  });

  it("leaves the focus on an element inside the dialog", () => {
    const target = fakeTarget();

    focusOnEntered(fakeNode(field), target as unknown as HTMLElement);

    expect(target.focus).not.toHaveBeenCalled();
  });

  it("does nothing without a target", () => {
    expect(() => focusOnEntered(fakeNode(dialog), null)).not.toThrow();
  });
});
