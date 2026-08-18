/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectedRiotAccounts } from "@/app/dashboard/connected-riot-accounts";

const refreshPage = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshPage }),
}));

afterEach(() => {
  cleanup();
  refreshPage.mockReset();
});

const accounts = [
  {
    authStatus: "CONNECTED" as const,
    connectedAt: "2026-08-15T01:00:00.000Z",
    gameName: null,
    id: "11111111-1111-4111-8111-111111111111",
    label: "Main",
    lastRefreshAt: "2026-08-17T00:05:00.000Z",
    region: "ap",
    tagLine: null,
  },
  {
    authStatus: "REAUTH_REQUIRED" as const,
    connectedAt: "2026-08-16T01:00:00.000Z",
    gameName: null,
    id: "22222222-2222-4222-8222-222222222222",
    label: "Alt",
    lastRefreshAt: null,
    region: "na",
    tagLine: null,
  },
];

describe("ConnectedRiotAccounts", () => {
  it("makes every account and the add-another action visible", () => {
    render(<ConnectedRiotAccounts accounts={accounts} disconnect={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alt" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /connect another riot account/i }),
    ).toHaveAttribute("href", "#connect-riot-account");
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute(
      "href",
      expect.stringContaining(accounts[1].id),
    );
  });

  it("disconnects only the explicitly confirmed account", async () => {
    const user = userEvent.setup();
    const disconnect = vi.fn().mockResolvedValue({ ok: true });
    render(
      <ConnectedRiotAccounts accounts={accounts} disconnect={disconnect} />,
    );

    const disconnectButtons = screen.getAllByRole("button", {
      name: "Disconnect",
    });
    await user.click(disconnectButtons[1]);
    const confirmation = screen.getByRole("group", {
      name: "Confirm disconnect Alt",
    });
    const confirmButton = screen.getByRole("button", {
      name: "Confirm disconnect",
    });
    expect(confirmation).toHaveAttribute("aria-live", "polite");
    expect(confirmButton).toHaveFocus();
    await user.click(confirmButton);

    expect(disconnect).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledWith(accounts[1].id);
    expect(refreshPage).toHaveBeenCalledOnce();
  });

  it("returns focus to the disconnect trigger when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    render(<ConnectedRiotAccounts accounts={accounts} disconnect={vi.fn()} />);
    const disconnectButtons = screen.getAllByRole("button", {
      name: "Disconnect",
    });

    await user.click(disconnectButtons[0]);
    expect(
      screen.getByRole("button", { name: "Confirm disconnect" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(disconnectButtons[0]).toHaveFocus();
    expect(
      screen.queryByRole("group", { name: "Confirm disconnect Main" }),
    ).not.toBeInTheDocument();
  });
});
