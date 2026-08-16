import { afterEach, describe, expect, it, vi } from "vitest";

import {
  prefersReducedMotion,
  subscribeReducedMotion,
} from "@/src/lib/motion/reduced-motion";

function createMatchMediaStub(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.add(listener);
    }),
    matches,
    media: "(prefers-reduced-motion: reduce)",
    removeEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.delete(listener);
    }),
  };
  const matchMedia = vi.fn(() => query as unknown as MediaQueryList);

  return {
    fireChange: () => {
      for (const listener of [...listeners]) listener();
    },
    listeners,
    matchMedia,
    query,
  };
}

function stubWindow(overrides: Record<string, unknown>) {
  vi.stubGlobal("window", overrides as unknown as Window & typeof globalThis);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefersReducedMotion", () => {
  it("returns true when window is undefined", () => {
    expect(prefersReducedMotion()).toBe(true);
  });

  it("returns true when matchMedia is missing", () => {
    stubWindow({});

    expect(prefersReducedMotion()).toBe(true);
  });

  it("reflects the media query matches value", () => {
    const reduced = createMatchMediaStub(true);
    stubWindow({ matchMedia: reduced.matchMedia });
    expect(prefersReducedMotion()).toBe(true);

    const unrestricted = createMatchMediaStub(false);
    stubWindow({ matchMedia: unrestricted.matchMedia });
    expect(prefersReducedMotion()).toBe(false);
    expect(unrestricted.matchMedia).toHaveBeenCalledWith(
      "(prefers-reduced-motion: reduce)",
    );
  });
});

describe("subscribeReducedMotion", () => {
  it("returns a no-op unsubscriber without matchMedia", () => {
    const unsubscribe = subscribeReducedMotion(() => {});

    expect(() => unsubscribe()).not.toThrow();
  });

  it("fires the callback on change and unsubscribes cleanly", () => {
    const stub = createMatchMediaStub(false);
    stubWindow({ matchMedia: stub.matchMedia });

    const callback = vi.fn();
    const unsubscribe = subscribeReducedMotion(callback);

    expect(stub.query.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );

    stub.fireChange();
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(stub.listeners.size).toBe(0);

    stub.fireChange();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
