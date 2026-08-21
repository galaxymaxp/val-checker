/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { CloudRiotConnect } from "@/app/connect/riot/cloud-riot-connect";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  [375, 667],
  [390, 844],
  [430, 932],
])("cloud Riot connection at %ix%i", (width, height) => {
  it("requests a matching mobile viewport and renders the isolated viewer", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          expiresAt: "2026-08-21T00:08:00.000Z",
          failureCode: null,
          id: "5b0cb64f-7d14-456a-842b-369ecf3d2f61",
          state: "waiting_for_user",
          streamUrl:
            "https://browser.example.test/session/provider-id#token=viewer-token",
        }),
        { headers: { "Content-Type": "application/json" }, status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<CloudRiotConnect region="ap" />);

    const frame = await screen.findByTitle("Temporary Riot sign-in browser");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      consentGranted: true,
      region: "ap",
      viewport: { height, width },
    });
  });
});
