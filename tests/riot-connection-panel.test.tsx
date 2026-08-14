/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RiotConnectionPanel } from "@/app/dashboard/riot-connection-panel";

afterEach(cleanup);

describe("Riot connection consent UI", () => {
  it("keeps production connection closed without accepting credential input", () => {
    render(
      <RiotConnectionPanel
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Riot connection not yet available" }),
    ).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "does not accept real Riot credentials or session material",
    );
  });

  it("exercises fixture-only connect and disconnect behavior", async () => {
    const user = userEvent.setup();
    const connectFixture = vi.fn().mockResolvedValue({ ok: true });
    const disconnect = vi.fn().mockResolvedValue({ ok: true });
    render(
      <RiotConnectionPanel
        connectFixture={connectFixture}
        disconnect={disconnect}
        fixtureMode
        initialState="disconnected"
      />,
    );

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Connect fixture session" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Fixture connected" })).toBeInTheDocument();
    });
    expect(connectFixture).toHaveBeenCalledWith(true);

    await user.click(
      screen.getByRole("button", { name: "Disconnect and delete stored session" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Connection paused" })).toBeInTheDocument();
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("plainly discloses storage, access, encryption, revocation, and Riot logout", () => {
    render(
      <RiotConnectionPanel
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    expect(screen.getByText(/stores Riot cookie and session account-access material/i)).toBeInTheDocument();
    expect(screen.getByText(/can permit access to your Riot account/i)).toBeInTheDocument();
    expect(screen.getByText(/encrypted at rest/i)).toBeInTheDocument();
    expect(screen.getByText(/disconnect and delete it/i)).toBeInTheDocument();
    expect(screen.getByText(/Sign out everywhere/i)).toBeInTheDocument();
  });
});
