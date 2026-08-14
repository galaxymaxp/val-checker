import { describe, expect, it, vi } from "vitest";

import {
  FixtureSessionInputError,
  MAX_SUBMITTED_COOKIE_JAR_BYTES,
  ManualCookieProvider,
  QR_SESSION_PROVIDER,
  SubmittedCookieProvider,
  SubmittedSessionInputError,
} from "@/src/lib/riot/session-provider";

describe("Phase 5 session providers", () => {
  it("captures an injected fixture without reading files or calling a network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fixtureBytes = new Uint8Array([102, 105, 120, 116, 117, 114, 101]);
    const provider = new ManualCookieProvider({
      now: () => new Date("2026-08-14T09:00:00.000Z"),
    });

    const session = await provider.capture({
      fixtureOnly: true,
      serializedJar: fixtureBytes,
    });

    expect(session.kind).toBe("captured-session");
    expect(session.provider).toBe("manual-cookie");
    expect(session.fixtureOnly).toBe(true);
    expect(session.capturedAt).toBe("2026-08-14T09:00:00.000Z");
    expect(session.material).not.toBe(fixtureBytes);
    expect(session.material.byteLength).toBe(fixtureBytes.byteLength);
    expect(fetchMock).not.toHaveBeenCalled();

    const capturedFirstByte = session.material[0];
    fixtureBytes.fill(0);
    expect(session.material[0]).toBe(capturedFirstByte);
  });

  it("rejects missing fixture material without echoing it", async () => {
    const provider = new ManualCookieProvider();

    await expect(
      provider.capture({ fixtureOnly: true, serializedJar: new Uint8Array() }),
    ).rejects.toThrow(FixtureSessionInputError);
  });

  it("keeps QR authentication as an explicit unsupported descriptor", () => {
    expect(QR_SESSION_PROVIDER.kind).toBe("qr");
    expect(QR_SESSION_PROVIDER.status).toBe("not-supported");
  });

  it.each([
    JSON.stringify([
      {
        domain: ".riotgames.com",
        name: "ssid",
        path: "/",
        secure: true,
        value: "offline-session-value",
      },
    ]),
    JSON.stringify([
      {
        "Content raw": "offline-session-value",
        "Host raw": "https://auth.riotgames.com/",
        "Name raw": "ssid",
        "Path raw": "/",
      },
    ]),
  ])("captures a supported submitted cookie export without network calls", async (jar) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new SubmittedCookieProvider({
      now: () => new Date("2026-08-14T10:00:00.000Z"),
    });

    const session = await provider.capture({ serializedJar: jar });

    expect(session.fixtureOnly).toBe(false);
    expect(session.capturedAt).toBe("2026-08-14T10:00:00.000Z");
    expect(new TextDecoder().decode(session.material)).toBe(jar);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized submissions without echoing material", async () => {
    const provider = new SubmittedCookieProvider();
    const marker = "do-not-echo-cookie-material";

    for (const serializedJar of [
      JSON.stringify([{ domain: ".riotgames.com", value: marker }]),
      "x".repeat(MAX_SUBMITTED_COOKIE_JAR_BYTES + 1),
    ]) {
      try {
        await provider.capture({ serializedJar });
        expect.unreachable("Invalid submitted session material must be rejected.");
      } catch (error) {
        expect(error).toBeInstanceOf(SubmittedSessionInputError);
        expect((error as Error).message).not.toContain(marker);
      }
    }
  });
});
