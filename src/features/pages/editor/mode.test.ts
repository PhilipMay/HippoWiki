import { describe, expect, it } from "vitest";

import { MODE_STORAGE_KEY, readMode, storeMode, type EditorMode } from "@/features/pages/editor/mode";

/** A storage in memory, as `localStorage` holds the mode. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    get length() {
      return values.size;
    },
  };
}

const throwing = (): Storage => {
  throw new Error("The storage is blocked");
};

describe("the mode of the editor (R18)", () => {
  it.each(["live", "source"] as EditorMode[])("reads back the stored mode %s", (mode) => {
    const storage = memoryStorage();
    storeMode(() => storage, mode);
    expect(readMode(() => storage)).toBe(mode);
  });

  it("gives live preview without a stored value and for an unknown value", () => {
    const storage = memoryStorage();
    expect(readMode(() => storage)).toBe("live");
    storage.setItem(MODE_STORAGE_KEY, "preview");
    expect(readMode(() => storage)).toBe("live");
  });

  it("gives live preview when the storage throws, and ignores a storage that throws on writing", () => {
    expect(readMode(throwing)).toBe("live");
    expect(() => storeMode(throwing, "source")).not.toThrow();
    const failing = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(() => storeMode(() => failing, "source")).not.toThrow();
  });
});
