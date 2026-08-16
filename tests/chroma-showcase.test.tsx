/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ChromaShowcase } from "@/app/dashboard/_components/chroma-showcase";
import type { ChromaView } from "@/src/types/catalog-view";

function chroma(
  ordinal: number,
  overrides: Partial<ChromaView> = {},
): ChromaView {
  return {
    chromaUuid: `chroma-${ordinal}`,
    displayIcon: null,
    fullRender: `https://media.valorant-api.com/render-${ordinal}.png`,
    ordinal,
    streamedVideo: null,
    swatch: `https://media.valorant-api.com/swatch-${ordinal}.png`,
    variantLabel: ordinal === 0 ? null : `Variant ${ordinal} Red`,
    ...overrides,
  };
}

const fixture: ChromaView[] = [
  chroma(0),
  chroma(1),
  chroma(2, { variantLabel: "Variant 2 Blue" }),
];

/** True when some rendered image points at the given source URL. */
function showsImage(source: string): boolean {
  return [...document.querySelectorAll("img")].some((image) =>
    decodeURIComponent(image.getAttribute("src") ?? "").includes(source),
  );
}

afterEach(cleanup);

describe("ChromaShowcase", () => {
  it("renders one accessibly named swatch button per chroma", () => {
    render(
      <ChromaShowcase
        chromas={fixture}
        fallbackRender={null}
        skinUuid="skin-1"
        tierColor={null}
      />,
    );

    expect(screen.getByRole("button", { name: "Base" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Variant 1 Red" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Variant 2 Blue" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("selects a chroma on click, flipping aria-pressed and the hero render", async () => {
    const user = userEvent.setup();
    render(
      <ChromaShowcase
        chromas={fixture}
        fallbackRender={null}
        skinUuid="skin-1"
        tierColor="ff4655ff"
      />,
    );

    const base = screen.getByRole("button", { name: "Base" });
    const variant = screen.getByRole("button", { name: "Variant 1 Red" });

    expect(base).toHaveAttribute("aria-pressed", "true");
    expect(variant).toHaveAttribute("aria-pressed", "false");
    expect(showsImage("render-0.png")).toBe(true);

    await user.click(variant);

    expect(base).toHaveAttribute("aria-pressed", "false");
    expect(variant).toHaveAttribute("aria-pressed", "true");
    expect(showsImage("render-1.png")).toBe(true);
  });

  it("shows the fallback render and no VARIANTS row without chromas", () => {
    render(
      <ChromaShowcase
        chromas={[]}
        fallbackRender="https://media.valorant-api.com/fallback.png"
        skinUuid="skin-1"
        tierColor={null}
      />,
    );

    expect(showsImage("fallback.png")).toBe(true);
    expect(screen.queryByText("VARIANTS")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
