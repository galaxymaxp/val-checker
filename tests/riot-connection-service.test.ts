import { describe, expect, it, vi } from "vitest";

import {
  RiotConnectionService,
  RiotConsentRequiredError,
} from "@/src/lib/riot/connection-service";
import { ManualCookieProvider } from "@/src/lib/riot/session-provider";
import type { SessionStore } from "@/src/lib/riot/session-store";

function fixtureStore(): SessionStore {
  return {
    delete: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

describe("offline Riot connection application flow", () => {
  it("requires explicit consent before storing a fixture session", async () => {
    const store = fixtureStore();
    const service = new RiotConnectionService(new ManualCookieProvider(), store);

    await expect(
      service.connectFixture({
        consentGranted: false,
        fixture: {
          fixtureOnly: true,
          serializedJar: new Uint8Array([1, 2, 3]),
        },
        userId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toThrow(RiotConsentRequiredError);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("connects and disconnects injected fixture material without network calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const store = fixtureStore();
    const service = new RiotConnectionService(new ManualCookieProvider(), store);
    const userId = "11111111-1111-4111-8111-111111111111";

    await expect(
      service.connectFixture({
        consentGranted: true,
        fixture: {
          fixtureOnly: true,
          serializedJar: new Uint8Array([1, 2, 3]),
        },
        userId,
      }),
    ).resolves.toBe("connected");
    expect(store.save).toHaveBeenCalledTimes(1);

    await expect(service.disconnect(userId)).resolves.toBe("disconnected");
    expect(store.delete).toHaveBeenCalledWith(userId);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
