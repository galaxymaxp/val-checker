import { describe, expect, it, vi } from "vitest";

import type { Session } from "@/src/lib/riot/adapter";
import {
  reauthenticateAndPersist,
  ReauthPersistenceRunError,
} from "@/src/lib/riot/reauth-persistence";

vi.mock("server-only", () => ({}));

function session(marker: number): Session {
  return {
    capturedAt: `2026-08-14T0${marker}:00:00.000Z`,
    fixtureOnly: true,
    kind: "captured-session",
    material: new Uint8Array([marker]),
    provider: "manual-cookie",
  };
}

describe("reauthenticated session persistence", () => {
  it("awaits encrypted persistence before releasing the rotated session", async () => {
    const initial = session(1);
    const rotated = session(2);
    let releasePersistence: (() => void) | undefined;
    const persistRotated = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releasePersistence = resolve;
        }),
    );
    const refreshSession = vi.fn().mockResolvedValue(rotated);
    const completed = vi.fn();

    const run = reauthenticateAndPersist({
      adapter: { refreshSession },
      connectionId: "33333333-3333-4333-8333-333333333333",
      expectedConnectionEpoch: "epoch-id",
      session: initial,
      store: { persistRotated },
      userId: "user-id",
    }).then((value) => {
      completed(value);
      return value;
    });

    await vi.waitFor(() => {
      expect(persistRotated).toHaveBeenCalledWith(
        "user-id",
        "33333333-3333-4333-8333-333333333333",
        rotated,
        "epoch-id",
      );
    });
    expect(completed).not.toHaveBeenCalled();

    releasePersistence?.();
    await expect(run).resolves.toBe(rotated);
    expect(refreshSession).toHaveBeenCalledWith(initial);
    expect(completed).toHaveBeenCalledWith(rotated);
  });

  it("classifies persistence failure before any subsequent Riot step", async () => {
    const sensitiveMarker = "cookie-value-that-must-not-escape";
    const rotated = session(2);
    const nextRiotStep = vi.fn();

    const run = reauthenticateAndPersist({
      adapter: { refreshSession: vi.fn().mockResolvedValue(rotated) },
      connectionId: "33333333-3333-4333-8333-333333333333",
      expectedConnectionEpoch: "epoch-id",
      session: session(1),
      store: {
        persistRotated: vi
          .fn()
          .mockRejectedValue(new Error(sensitiveMarker)),
      },
      userId: "user-id",
    }).then(nextRiotStep);

    try {
      await run;
      expect.unreachable("Persistence failure must fail the run.");
    } catch (error) {
      expect(error).toBeInstanceOf(ReauthPersistenceRunError);
      expect(error).toMatchObject({ classification: "ERROR" });
      expect((error as Error).message).not.toContain(sensitiveMarker);
    }
    expect(nextRiotStep).not.toHaveBeenCalled();
  });

  it("does not write when reauthentication itself fails", async () => {
    const failure = new Error("reauth failed");
    const persistRotated = vi.fn();

    await expect(
      reauthenticateAndPersist({
        adapter: { refreshSession: vi.fn().mockRejectedValue(failure) },
        connectionId: "33333333-3333-4333-8333-333333333333",
      expectedConnectionEpoch: "epoch-id",
        session: session(1),
        store: { persistRotated },
        userId: "user-id",
      }),
    ).rejects.toBe(failure);
    expect(persistRotated).not.toHaveBeenCalled();
  });
});
