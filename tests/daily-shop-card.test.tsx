/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DailyShopCard } from "@/app/dashboard/_components/daily-shop-card";

afterEach(cleanup);

describe("DailyShopCard", () => {
  it("renders the offer name", () => {
    render(
      <DailyShopCard
        offer={{
          displayIcon: null,
          displayName: "Prime Vandal",
          skinUuid: "prime-vandal",
          watched: false,
        }}
      />,
    );

    expect(screen.getByText("Prime Vandal")).toBeInTheDocument();
    expect(screen.queryByText("On your watchlist")).not.toBeInTheDocument();
  });

  it("shows the watchlist chip only for watched offers", () => {
    render(
      <DailyShopCard
        offer={{
          displayIcon: null,
          displayName: "Reaver Sheriff",
          skinUuid: "reaver-sheriff",
          watched: true,
        }}
      />,
    );

    expect(screen.getByText("On your watchlist")).toBeInTheDocument();
  });
});
