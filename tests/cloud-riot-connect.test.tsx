/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
  vi.restoreAllMocks();
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

it("keeps the Riot viewer mounted during a transient status delay", async () => {
  let poll: (() => Promise<void>) | undefined;
  vi.spyOn(window, "setInterval").mockImplementation((callback) => {
    poll = callback as () => Promise<void>;
    return 1 as unknown as ReturnType<typeof setInterval>;
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          expiresAt: "2026-08-21T00:15:00.000Z",
          failureCode: null,
          id: "5b0cb64f-7d14-456a-842b-369ecf3d2f61",
          state: "waiting_for_user",
          streamUrl:
            "https://browser.example.test/session/provider-id#token=viewer-token",
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Riot connection is temporarily unavailable." }),
        { headers: { "Content-Type": "application/json" }, status: 503 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);

  render(
    <CloudRiotConnect
      initialSessionId="5b0cb64f-7d14-456a-842b-369ecf3d2f61"
      region="ap"
    />,
  );

  await screen.findByTitle("Temporary Riot sign-in browser");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/riot/cloud/sessions/5b0cb64f-7d14-456a-842b-369ecf3d2f61?stream=1",
    { cache: "no-store" },
  );
  await act(async () => {
    await poll?.();
  });

  expect(
    screen.getByText("Connection check delayed. Your Riot window is still active."),
  ).toBeInTheDocument();
  expect(screen.getByTitle("Temporary Riot sign-in browser")).toBeInTheDocument();
});
