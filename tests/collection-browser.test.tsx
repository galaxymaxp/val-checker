/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CollectionBrowser } from "@/app/dashboard/collection-browser";
import type { CatalogWeaponView } from "@/src/lib/catalog/browse";

const fixture: CatalogWeaponView[] = [
  {
    category: "Rifle",
    displayName: "Vandal",
    skins: [
      {
        contentTier: "exclusive",
        displayIcon: null,
        displayName: "Prime Vandal",
        skinUuid: "prime-skin",
      },
      {
        contentTier: null,
        displayIcon: null,
        displayName: "Luxe Vandal",
        skinUuid: "luxe-skin",
      },
    ],
    weaponUuid: "vandal",
  },
  {
    category: "Sidearm",
    displayName: "Classic",
    skins: [
      {
        contentTier: null,
        displayIcon: null,
        displayName: "Prime Classic",
        skinUuid: "classic-skin",
      },
    ],
    weaponUuid: "classic",
  },
];

afterEach(cleanup);

function renderBrowser({
  initialWatchedSkinUuids = [],
  updateWatch = vi.fn().mockResolvedValue({ ok: true }),
}: {
  initialWatchedSkinUuids?: readonly string[];
  updateWatch?: (skinUuid: string, watched: boolean) => Promise<{
    ok: boolean;
    error?: string;
  }>;
} = {}) {
  return render(
    <CollectionBrowser
      initialWatchedSkinUuids={initialWatchedSkinUuids}
      updateWatch={updateWatch}
      weapons={fixture}
    />,
  );
}

describe("collection browser", () => {
  it("lists categories, weapon cards, and skins", () => {
    renderBrowser();

    expect(screen.getByRole("heading", { name: "Rifle" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vandal" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Prime Vandal" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sidearm" })).toBeInTheDocument();
  });

  it("filters skins by search text", async () => {
    const user = userEvent.setup();
    renderBrowser();

    await user.type(screen.getByRole("searchbox"), "luxe");

    expect(screen.getByRole("heading", { name: "Luxe Vandal" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Prime Vandal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Classic" })).not.toBeInTheDocument();
  });

  it("toggles local watch state and applies the watched-only filter", async () => {
    const user = userEvent.setup();
    renderBrowser();
    const watchPrime = screen.getByRole("button", { name: "Watch Prime Vandal" });

    await user.click(watchPrime);
    expect(screen.getByRole("button", { name: "Stop watching Prime Vandal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Watched only" }));

    expect(screen.getByRole("heading", { name: "Prime Vandal" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Luxe Vandal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Classic" })).not.toBeInTheDocument();
  });

  it("hydrates persisted watch state after a reload", () => {
    renderBrowser({ initialWatchedSkinUuids: ["prime-skin"] });

    expect(screen.getByRole("button", { name: "Stop watching Prime Vandal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("rolls an optimistic add back when the server action fails", async () => {
    const user = userEvent.setup();
    let resolveUpdate: (result: { ok: boolean; error?: string }) => void = () => {};
    const updateWatch = vi.fn(
      () =>
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    renderBrowser({ updateWatch });

    await user.click(screen.getByRole("button", { name: "Watch Prime Vandal" }));

    expect(screen.getByRole("button", { name: "Stop watching Prime Vandal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    resolveUpdate({ error: "forced failure", ok: false });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Watch Prime Vandal" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
    expect(screen.getByRole("alert")).toHaveTextContent("previous watchlist was restored");
  });
});
