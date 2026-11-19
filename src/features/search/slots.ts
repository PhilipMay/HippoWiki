// The slots of the searches that run at the same time. Pure: no database and no server-only imports, so that a test
// controls the work it runs.

/** A fixed number of slots for work that runs at the same time. */
export type Slots = {
  /**
   * Runs the work in a free slot and returns its promise, or `null` at once, without running it, when every slot is
   * taken: it never waits. The slot is freed when the work ends, also when it fails.
   */
  tryRun<Value>(work: () => Promise<Value>): Promise<Value> | null;
};

/** Slots for at most the given number of works at the same time. */
export function createSlots(size: number): Slots {
  let running = 0;
  return {
    tryRun<Value>(work: () => Promise<Value>): Promise<Value> | null {
      if (running >= size) return null;
      running++;
      const free = () => {
        running--;
      };
      try {
        return work().finally(free);
      } catch (err) {
        // The work threw before it returned its promise.
        free();
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    },
  };
}
