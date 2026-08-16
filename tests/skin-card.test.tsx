/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkinCard } from "@/app/dashboard/_components/skin-card";
import type { WeaponSkinRowView } from "@/src/types/catalog-view";

afterEach(cleanup);

const skin: WeaponSkinRowView = {
  displayIcon: null,
  displayName: "Prime Vandal",
  fullRender: null,
  skinUuid: "11111111-1111-4111-8111-111111111111",
  tier: null,
  watched: false,
};

const weaponUuid = "22222222-2222-4222-8222-222222222222";

describe("SkinCard", () => {
  it("links the art and name to the skin detail page", () => {
    render(
      <SkinCard
        skin={skin}
        updateWatch={vi.fn(async () => ({ ok: true as const }))}
        weaponUuid={weaponUuid}
      />,
    );

    const link = screen.getByRole("link", { name: /Prime Vandal/ });

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/inventory/${weaponUuid}/${skin.skinUuid}`,
    );
  });

  it("keeps the watch toggle outside the link", () => {
    render(
      <SkinCard
        skin={skin}
        updateWatch={vi.fn(async () => ({ ok: true as const }))}
        weaponUuid={weaponUuid}
      />,
    );

    const button = screen.getByRole("button", { name: "Watch Prime Vandal" });

    // A nested interactive element would be an accessibility violation.
    expect(button.closest("a")).toBeNull();
  });
});
