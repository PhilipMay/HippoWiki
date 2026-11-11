import { useSyncExternalStore } from "react";

// Nothing to subscribe to: the value only changes once, from the server render to the first client render.
const subscribe = () => () => {};

/**
 * Whether the component has been hydrated: false in the server render and during hydration, true afterwards and in
 * every render that starts on the client. Interactive controls stay read-only or disabled until then, because input
 * during hydration can be lost: React sets the value of a hydrating text field again, which resets its selection, and a
 * click on a button before its handler is attached does nothing.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
