// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RiotAccountSwitcher } from "@/app/dashboard/riot-account-switcher";

describe("Riot account switcher", () => {
  it("renders a readable primary action for a new account", () => {
    render(<RiotAccountSwitcher accounts={[]} selectedConnectionId={null} />);

    const action = screen.getByRole("link", { name: "Connect Riot account" });
    expect(action).toHaveClass("bg-white", "text-bg!");
    expect(action).toHaveAttribute(
      "href",
      "/dashboard/connection#connect-riot-account",
    );
  });
});
