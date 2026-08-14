import { describe, expect, it, vi } from "vitest";

import {
  RiotConnectAllowlist,
  RiotConnectNotAllowedError,
} from "@/src/lib/riot/connect-allowlist";
import {
  RiotConnectionService,
  RiotConsentRequiredError,
} from "@/src/lib/riot/connection-service";
import {
  ManualCookieProvider,
  SubmittedCookieProvider,
} from "@/src/lib/riot/session-provider";
import type { SessionStore } from "@/src/lib/riot/session-store";

vi.mock("server-only", () => ({}));

const allowedUserId = "11111111-1111-4111-8111-111111111111";
const submittedJar = JSON.stringify([
  {
    domain: ".riotgames.com",
    name: "ssid",
    path: "/",
    value: "offline-session-value",
  },
]);

function allowlist(userIds = allowedUserId) {
  return new RiotConnectAllowlist({
    RIOT_CONNECT_ALLOWED_USER_IDS: userIds,
  });
}

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
    const service = new RiotConnectionService(
      new ManualCookieProvider(),
      store,
      allowlist(),
    );

    await expect(
      service.connectFixture({
        consentGranted: false,
        fixture: {
          fixtureOnly: true,
          serializedJar: new Uint8Array([1, 2, 3]),
        },
        identity: { userId: allowedUserId },
      }),
    ).rejects.toThrow(RiotConsentRequiredError);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("connects and disconnects injected fixture material without network calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const store = fixtureStore();
    const service = new RiotConnectionService(
      new ManualCookieProvider(),
      store,
      allowlist(),
    );
    const userId = allowedUserId;

    await expect(
      service.connectFixture({
        consentGranted: true,
        fixture: {
          fixtureOnly: true,
          serializedJar: new Uint8Array([1, 2, 3]),
        },
        identity: { userId },
      }),
    ).resolves.toBe("connected");
    expect(store.save).toHaveBeenCalledTimes(1);

    await expect(service.disconnect(userId)).resolves.toBe("disconnected");
    expect(store.delete).toHaveBeenCalledWith(userId);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-allowlisted user before capture or storage", async () => {
    const provider = new ManualCookieProvider();
    const capture = vi.spyOn(provider, "capture");
    const store = fixtureStore();
    const service = new RiotConnectionService(provider, store, allowlist());

    await expect(
      service.connectFixture({
        consentGranted: true,
        fixture: {
          fixtureOnly: true,
          serializedJar: new Uint8Array([1, 2, 3]),
        },
        identity: {
          email: "authenticated@example.com",
          userId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    ).rejects.toThrow(RiotConnectNotAllowedError);
    expect(capture).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("captures an allowlisted submitted session offline with AP as the default region", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const store = fixtureStore();
    const submittedProvider = new SubmittedCookieProvider({
      now: () => new Date("2026-08-14T10:00:00.000Z"),
    });
    const service = new RiotConnectionService(
      new ManualCookieProvider(),
      store,
      allowlist(),
      submittedProvider,
    );

    await expect(
      service.connect({
        consentGranted: true,
        identity: { userId: allowedUserId },
        session: { serializedJar: submittedJar },
      }),
    ).resolves.toBe("connected");

    expect(store.save).toHaveBeenCalledWith(
      allowedUserId,
      expect.objectContaining({ fixtureOnly: false }),
      { region: "ap" },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects submitted material before capture when the identity is not allowlisted", async () => {
    const store = fixtureStore();
    const submittedProvider = new SubmittedCookieProvider();
    const capture = vi.spyOn(submittedProvider, "capture");
    const service = new RiotConnectionService(
      new ManualCookieProvider(),
      store,
      allowlist(),
      submittedProvider,
    );

    await expect(
      service.connect({
        consentGranted: true,
        identity: {
          email: "authenticated@example.com",
          userId: "22222222-2222-4222-8222-222222222222",
        },
        region: "eu",
        session: { serializedJar: submittedJar },
      }),
    ).rejects.toThrow(RiotConnectNotAllowedError);

    expect(capture).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("requires consent before submitted material is captured", async () => {
    const store = fixtureStore();
    const submittedProvider = new SubmittedCookieProvider();
    const capture = vi.spyOn(submittedProvider, "capture");
    const service = new RiotConnectionService(
      new ManualCookieProvider(),
      store,
      allowlist(),
      submittedProvider,
    );

    await expect(
      service.connect({
        consentGranted: false,
        identity: { userId: allowedUserId },
        session: { serializedJar: submittedJar },
      }),
    ).rejects.toThrow(RiotConsentRequiredError);
    expect(capture).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });
});
