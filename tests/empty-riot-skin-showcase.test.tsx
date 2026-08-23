/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmptyRiotSkinShowcase } from "@/app/dashboard/_components/empty-riot-skin-showcase";
import type { ShowcaseSkinView } from "@/src/types/catalog-view";

function skin(index: number): ShowcaseSkinView {
  return {
    displayIcon: `https://media.valorant-api.com/weaponskins/skin-${index}/displayicon.png`,
    displayName: `Skin ${index} Alpha`,
    skinUuid: `skin-${index}`,
  };
}

/** Every card in the fan, plus spares to swap in. */
const CARD_COUNT = 5;
const pool = Array.from({ length: 18 }, (_, index) => skin(index));

/** The skin source rendered on each card's currently opaque face. */
function visibleSkins(): string[] {
  return [...document.querySelectorAll(".skin-fan-card")].flatMap((card) => {
    const face = card.querySelector('.skin-fan-face[data-active="true"]');
    const source = face?.querySelector("img")?.getAttribute("src") ?? "";

    return [decodeURIComponent(source)];
  });
}

/** jsdom reports 0x0 for every image, so intrinsic size has to be faked. */
function setNaturalSize(image: Element, width: number, height: number) {
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (media: string) => ({
    addEventListener: () => {},
    matches: reduce,
    media,
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  stubReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("EmptyRiotSkinShowcase", () => {
  it("renders one card per fan slot, seeded from the head of the pool", () => {
    render(<EmptyRiotSkinShowcase skins={pool} />);

    expect(document.querySelectorAll(".skin-fan-card")).toHaveLength(CARD_COUNT);
    // Deterministic on the server and the client alike: the pool arrives
    // shuffled, and the opening fan is a plain slice of it.
    for (let index = 0; index < CARD_COUNT; index += 1) {
      expect(visibleSkins()[index]).toContain(`skin-${index}/displayicon.png`);
    }
  });

  it("features the middle slot and splits each name into skin and weapon", () => {
    render(<EmptyRiotSkinShowcase skins={pool} />);

    const featured = document.querySelectorAll('[data-featured="true"]');
    expect(featured).toHaveLength(1);
    expect([...document.querySelectorAll(".skin-fan-card")].indexOf(featured[0]))
      .toBe(2);

    // "Skin 0 Alpha" reads as a skin line and a weapon line, the way the
    // store shows a name.
    expect(
      [...document.querySelectorAll(".skin-fan-name")].map(
        (node) => node.textContent,
      ),
    ).toContain("Skin 0");
    expect(
      [...document.querySelectorAll(".skin-fan-weapon")].map(
        (node) => node.textContent,
      ),
    ).toContain("Alpha");
  });

  it("names the section but keeps the fan out of the accessibility tree", () => {
    render(<EmptyRiotSkinShowcase skins={pool} />);

    expect(
      screen.getByRole("heading", {
        name: "Your next favourite skin is waiting",
      }),
    ).toBeInTheDocument();
    expect(document.querySelector(".skin-fan")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // The names inside rewrite themselves every few seconds, so they are art,
    // not content.
    for (const image of document.querySelectorAll(".skin-fan img")) {
      expect(image).toHaveAttribute("alt", "");
    }
  });

  it("renders nothing when the pool cannot fill the fan", () => {
    const { container } = render(
      <EmptyRiotSkinShowcase skins={pool.slice(0, CARD_COUNT - 1)} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("swaps one card at a time onto its hidden face", async () => {
    render(<EmptyRiotSkinShowcase skins={pool} />);

    const before = visibleSkins();

    act(() => {
      vi.advanceTimersByTime(7_000);
    });

    // The incoming skin mounts on the hidden face and waits for its image, so
    // nothing visible has changed yet -- and no card has gone blank.
    expect(visibleSkins()).toEqual(before);

    const pending = [...document.querySelectorAll(".skin-fan-card")].filter(
      (card) => card.querySelectorAll(".skin-fan-face").length === 2,
    );
    expect(pending).toHaveLength(1);

    const incoming = pending[0].querySelector<HTMLImageElement>(
      '.skin-fan-face[data-active="false"] img',
    );
    expect(incoming).not.toBeNull();

    // next/image decodes before it reports a load, so the reveal lands a
    // microtask later.
    await act(async () => {
      setNaturalSize(incoming!, 200, 46);
      incoming?.dispatchEvent(new Event("load"));
    });

    const after = visibleSkins();
    expect(after.filter((source, index) => source !== before[index])).toHaveLength(
      1,
    );
  });

  it("never shows the same skin on two cards at once", async () => {
    render(<EmptyRiotSkinShowcase skins={pool} />);

    // Long enough that cards start drawing skins their hidden face already
    // holds -- the case where the browser fires no second load event and the
    // card has to crossfade on its own.
    for (let round = 0; round < 40; round += 1) {
      act(() => {
        vi.advanceTimersByTime(7_000);
      });
      await act(async () => {
        for (const image of document.querySelectorAll("img")) {
          setNaturalSize(image, 200, 46);
          image.dispatchEvent(new Event("load"));
        }
      });

      expect(new Set(visibleSkins()).size).toBe(CARD_COUNT);
    }
  });

  it("retires a skin whose art is Riot's square placeholder", async () => {
    render(<EmptyRiotSkinShowcase skins={pool} />);

    const before = visibleSkins();

    act(() => {
      vi.advanceTimersByTime(7_000);
    });

    const incoming = document.querySelector<HTMLImageElement>(
      '.skin-fan-face[data-active="false"] img',
    );
    const placeholderSource = decodeURIComponent(
      incoming?.getAttribute("src") ?? "",
    );

    // Riot answers art it does not have with a 512x512 "X" rather than a 404.
    await act(async () => {
      setNaturalSize(incoming!, 200, 200);
      incoming?.dispatchEvent(new Event("load"));
    });

    // The card keeps what it was already showing rather than flipping to the X.
    expect(visibleSkins()).toEqual(before);

    // And the placeholder never comes back around.
    for (let round = 0; round < 30; round += 1) {
      act(() => {
        vi.advanceTimersByTime(7_000);
      });
      await act(async () => {
        for (const image of document.querySelectorAll("img")) {
          setNaturalSize(image, 200, 46);
          image.dispatchEvent(new Event("load"));
        }
      });

      expect(visibleSkins()).not.toContain(placeholderSource);
      expect(new Set(visibleSkins()).size).toBe(CARD_COUNT);
    }
  });

  it("holds the fan still when the user prefers reduced motion", async () => {
    stubReducedMotion(true);
    render(<EmptyRiotSkinShowcase skins={pool} />);

    const before = visibleSkins();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(visibleSkins()).toEqual(before);
    expect(
      document.querySelectorAll('.skin-fan-face[data-active="false"]'),
    ).toHaveLength(0);
  });
});
