/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManualStorefrontRefresh } from "@/app/dashboard/manual-storefront-refresh";

const refreshPage = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshPage }),
}));

afterEach(() => {
  cleanup();
  refreshPage.mockReset();
});

describe("ManualStorefrontRefresh", () => {
  it("targets one exact account and announces a successful update", async () => {
    const user = userEvent.setup();
    const refreshStore = vi.fn().mockResolvedValue({ ok: true });
    render(
      <ManualStorefrontRefresh
        availability="available"
        connectionId="11111111-1111-4111-8111-111111111111"
        nextAvailableAt="2026-08-18T00:00:00.000Z"
        refreshStore={refreshStore}
      />,
    );

    await user.click(screen.getByRole("button", { name: /refresh store/i }));

    expect(refreshStore).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(await screen.findByText("Updated just now.")).toBeInTheDocument();
    expect(refreshPage).toHaveBeenCalledOnce();
  });

  it("does not carry a result message into another selected account", async () => {
    const user = userEvent.setup();
    const firstRefresh = vi.fn().mockResolvedValue({ ok: true });
    const secondRefresh = vi.fn().mockResolvedValue({ ok: true });
    const { rerender } = render(
      <ManualStorefrontRefresh
        availability="available"
        connectionId="11111111-1111-4111-8111-111111111111"
        nextAvailableAt="2026-08-18T00:00:00.000Z"
        refreshStore={firstRefresh}
      />,
    );

    await user.click(screen.getByRole("button", { name: /refresh store/i }));
    expect(await screen.findByText("Updated just now.")).toBeInTheDocument();

    rerender(
      <ManualStorefrontRefresh
        availability="available"
        connectionId="22222222-2222-4222-8222-222222222222"
        nextAvailableAt="2026-08-18T00:00:00.000Z"
        refreshStore={secondRefresh}
      />,
    );

    expect(screen.queryByText("Updated just now.")).not.toBeInTheDocument();
    expect(screen.getByText(/1 manual refresh available/i)).toBeInTheDocument();
  });

  it("announces a successful refresh with a sanitized downstream warning", async () => {
    const user = userEvent.setup();
    const refreshStore = vi.fn().mockResolvedValue({
      ok: true,
      warning:
        "Skin details and watchlist matching are temporarily unavailable.",
    });
    render(
      <ManualStorefrontRefresh
        availability="available"
        connectionId="11111111-1111-4111-8111-111111111111"
        nextAvailableAt="2026-08-18T00:00:00.000Z"
        refreshStore={refreshStore}
      />,
    );

    await user.click(screen.getByRole("button", { name: /refresh store/i }));

    expect(
      await screen.findByText(
        /Updated just now\. Skin details and watchlist matching/i,
      ),
    ).toBeInTheDocument();
    expect(refreshPage).toHaveBeenCalledOnce();
  });

  it("explains and disables an allowance already used today", () => {
    render(
      <ManualStorefrontRefresh
        availability="succeeded"
        connectionId="11111111-1111-4111-8111-111111111111"
        nextAvailableAt="2026-08-18T00:00:00.000Z"
        refreshStore={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /refresh store/i })).toBeDisabled();
    expect(screen.getByText(/manual refresh used today/i)).toBeInTheDocument();
  });

  it("does not imply success after a post-request failure", () => {
    render(
      <ManualStorefrontRefresh
        availability="exhausted"
        connectionId="11111111-1111-4111-8111-111111111111"
        nextAvailableAt="2026-08-18T00:00:00.000Z"
        refreshStore={vi.fn()}
      />,
    );

    expect(screen.getByText(/reached Riot but did not complete/i)).toBeInTheDocument();
    expect(screen.queryByText("Updated just now.")).not.toBeInTheDocument();
  });
});
