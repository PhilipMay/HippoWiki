import { describe, expect, it } from "vitest";

import { createSlots } from "@/features/search/slots";

/** Work whose end the test controls. */
function controlledWork<Value>(): { work: () => Promise<Value>; end: (value: Value) => void; fail: () => void } {
  let resolve!: (value: Value) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<Value>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { work: () => promise, end: resolve, fail: () => reject(new Error("work failed")) };
}

describe("createSlots", () => {
  it("runs three works at once and refuses a fourth at once, without running it", async () => {
    const slots = createSlots(3);
    const works = [controlledWork<number>(), controlledWork<number>(), controlledWork<number>()];
    const running = works.map(({ work }) => slots.tryRun(work));
    const started = running.filter((promise) => promise !== null);
    expect(started).toHaveLength(3);

    let ran = false;
    expect(
      slots.tryRun(() => {
        ran = true;
        return Promise.resolve(4);
      }),
    ).toBeNull();
    expect(ran).toBe(false);

    works.forEach(({ end }, index) => end(index));
    expect(await Promise.all(started)).toEqual([0, 1, 2]);
  });

  it("frees a slot when its work ends", async () => {
    const slots = createSlots(1);
    const first = controlledWork<string>();
    const running = slots.tryRun(first.work);
    expect(slots.tryRun(() => Promise.resolve("second"))).toBeNull();

    first.end("first");
    expect(await running).toBe("first");
    expect(await slots.tryRun(() => Promise.resolve("second"))).toBe("second");
  });

  it("frees a slot when its work fails", async () => {
    const slots = createSlots(1);
    const first = controlledWork<string>();
    const running = slots.tryRun(first.work);

    first.fail();
    await expect(running).rejects.toThrow("work failed");
    expect(await slots.tryRun(() => Promise.resolve("next"))).toBe("next");
  });

  it("frees a slot when its work throws before it returns a promise", async () => {
    const slots = createSlots(1);
    const thrown = slots.tryRun(() => {
      throw new Error("thrown");
    });

    await expect(thrown).rejects.toThrow("thrown");
    expect(await slots.tryRun(() => Promise.resolve("next"))).toBe("next");
  });
});
