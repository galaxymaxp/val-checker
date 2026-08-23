"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  prefersReducedMotion,
  subscribeReducedMotion,
} from "@/src/lib/motion/reduced-motion";
import type { ShowcaseSkinView } from "@/src/types/catalog-view";

/** Cards in the fan. The middle slot is the featured one. */
const CARD_COUNT = 5;
const FEATURED_INDEX = 2;

/** Milliseconds between one card's skin swap and the next card's. */
const SWAP_MIN_MS = 4_000;
const SWAP_MAX_MS = 7_000;

/**
 * Floor between two hover-driven swaps of the same card. A card that is still
 * crossfading refuses on its own; this is for the case where the incoming art
 * was already cached and landed instantly, so wiggling the pointer over one
 * card cannot machine-gun through the pool.
 */
const HOVER_COOLDOWN_MS = 500;

interface EmptyRiotSkinShowcaseProps {
  readonly skins: readonly ShowcaseSkinView[];
}

interface FanCard {
  /** Which of the two stacked faces is the opaque one. */
  readonly active: number;
  readonly faces: readonly (ShowcaseSkinView | null)[];
}

function swapDelay(): number {
  return SWAP_MIN_MS + Math.random() * (SWAP_MAX_MS - SWAP_MIN_MS);
}

/**
 * The next card to swap: never the one that just changed, so two consecutive
 * swaps are always visibly in different places in the fan.
 */
function nextCardIndex(previous: number): number {
  const index = Math.floor(Math.random() * (CARD_COUNT - 1));

  return index >= previous ? index + 1 : index;
}

/**
 * "Champions 2023 Vandal" -> ["Champions 2023", "Vandal"].
 *
 * The catalog stores one display name per skin, and the weapon is its last
 * word. Splitting on that rather than joining the weapons table is deliberate:
 * every melee skin in the catalog belongs to a weapon literally named "Melee",
 * so the join would label a Reaver Karambit "MELEE" where its own name already
 * says "KARAMBIT".
 */
function splitSkinName(displayName: string): readonly [string, string | null] {
  const cut = displayName.lastIndexOf(" ");

  return cut === -1
    ? [displayName, null]
    : [displayName.slice(0, cut), displayName.slice(cut + 1)];
}

/**
 * The fan of skin cards under the empty Riot account card: four cards angled
 * away behind a featured one, holding the gap above the arsenal.
 *
 * Two things move independently. The fan itself only floats, in CSS, on
 * transform and opacity, so it never touches layout. The skin inside each card
 * is swapped one at a time on a self-rescheduling timer, drawn from the pool
 * the server already sent -- nothing is fetched again once the page is up.
 *
 * Hydration: the pool arrives pre-shuffled from the server, so the opening
 * five are a plain `slice` and the server and client agree on the markup.
 * Every later choice is random, and every later choice happens after mount.
 *
 * The fan is `aria-hidden`. It is a sample of the catalog rather than the
 * user's own data, and the names in it rewrite themselves every few seconds;
 * the heading and copy above it carry the meaning instead.
 */
export function EmptyRiotSkinShowcase({ skins }: EmptyRiotSkinShowcaseProps) {
  const opening = useMemo(() => skins.slice(0, CARD_COUNT), [skins]);
  const [cards, setCards] = useState<readonly FanCard[]>(() =>
    opening.map((skin) => ({ active: 0, faces: [skin, null] })),
  );
  const [motionAllowed, setMotionAllowed] = useState(false);

  /** Skins not in the fan right now. Swaps trade in and out of this. */
  const spare = useRef<ShowcaseSkinView[]>([]);
  /** What each card currently shows, mirrored so swaps stay pure. */
  const shown = useRef<ShowcaseSkinView[]>([]);
  const lastSwapped = useRef(0);
  /** When each card last swapped because the pointer entered it. */
  const lastHovered = useRef<number[]>([]);

  useEffect(() => {
    const inFan = new Set(opening.map((skin) => skin.skinUuid));

    shown.current = [...opening];
    spare.current = skins.filter((skin) => !inFan.has(skin.skinUuid));
  }, [opening, skins]);

  // `prefersReducedMotion` reports true on the server, so reading it during
  // render would mean two different trees. It only gates a timer here, so the
  // markup is identical either way and the preference is read after mount.
  useEffect(() => {
    const sync = () => setMotionAllowed(!prefersReducedMotion());

    sync();

    return subscribeReducedMotion(sync);
  }, []);

  useEffect(() => {
    if (!motionAllowed || skins.length <= CARD_COUNT) {
      return;
    }

    let timer = setTimeout(function tick() {
      drawInto(nextCardIndex(lastSwapped.current));
      timer = setTimeout(tick, swapDelay());
    }, swapDelay());

    return () => clearTimeout(timer);
  }, [motionAllowed, skins.length]);

  /** Trades one card's skin for a random one out of the spare pool. */
  function drawInto(cardIndex: number) {
    const pool = spare.current;

    if (pool.length === 0) {
      return;
    }

    // The card gives up its skin to the slot the new one came from, so the
    // pool stays the exact complement of what is in the fan.
    const poolIndex = Math.floor(Math.random() * pool.length);
    const incoming = pool[poolIndex];

    pool[poolIndex] = shown.current[cardIndex];
    shown.current[cardIndex] = incoming;
    lastSwapped.current = cardIndex;

    setCards((current) => {
      const card = current[cardIndex];

      if (!card) {
        return current;
      }

      const next = [...current];
      const incomingFace = 1 - card.active;
      const faces = [...card.faces];
      // The hidden face can already be holding this skin from an earlier
      // cycle. Its image is mounted and decoded, and the browser fires no
      // second load for an unchanged src, so nothing would ever flip the
      // card -- it crossfades right now instead of waiting for a load that
      // is never coming.
      const decoded = faces[incomingFace]?.skinUuid === incoming.skinUuid;
      faces[incomingFace] = incoming;
      // Otherwise `active` stays put: the new face loads behind the old one
      // and only takes over once it has actually decoded, so a swap never
      // flashes an empty card.
      next[cardIndex] = { active: decoded ? incomingFace : card.active, faces };

      return next;
    });
  }

  /**
   * Riot answers a skin it has no art for with a 512x512 "X" placeholder
   * rather than a 404, and the catalog stores that URL like any other one.
   * Every real weapon render is wider than it is tall, so a square image is
   * the placeholder: the skin leaves the rotation for good, and the card
   * either keeps what it was already showing or draws a replacement.
   */
  function retireArtless(cardIndex: number, artless: ShowcaseSkinView) {
    if (shown.current[cardIndex]?.skinUuid !== artless.skinUuid) {
      return;
    }

    const pool = spare.current;
    const card = cards[cardIndex];
    const displayed = card?.faces[card.active];

    if (displayed && displayed.skinUuid !== artless.skinUuid) {
      // The placeholder never made it onto the visible face. Put the skin the
      // card is still showing back where it belongs and drop the placeholder.
      const index = pool.findIndex(
        (skin) => skin.skinUuid === displayed.skinUuid,
      );

      if (index !== -1) {
        pool[index] = pool[pool.length - 1];
        pool.pop();
      }

      shown.current[cardIndex] = displayed;

      return;
    }

    // The placeholder came in with the opening deal, so it is already on
    // screen. Draw over it -- which hands the placeholder back to the pool --
    // then take it out of circulation for good.
    drawInto(cardIndex);

    const returned = pool.findIndex(
      (skin) => skin.skinUuid === artless.skinUuid,
    );

    if (returned !== -1) {
      pool[returned] = pool[pool.length - 1];
      pool.pop();
    }
  }

  /**
   * Hovering a card deals it a new skin. Decorative and pointer-only: the fan
   * is `aria-hidden`, so there is nothing here a keyboard or screen reader
   * user is missing -- the timer deals the same cards to everyone anyway.
   */
  function swapOnHover(cardIndex: number) {
    if (!motionAllowed || skins.length <= CARD_COUNT) {
      return;
    }

    const card = cards[cardIndex];
    const intended = shown.current[cardIndex];

    // Still crossfading the last one in. Let it land before dealing again,
    // otherwise the card would drop a skin it never finished showing.
    if (
      !card ||
      !intended ||
      card.faces[card.active]?.skinUuid !== intended.skinUuid
    ) {
      return;
    }

    const now = Date.now();

    if (now - (lastHovered.current[cardIndex] ?? 0) < HOVER_COOLDOWN_MS) {
      return;
    }

    lastHovered.current[cardIndex] = now;
    drawInto(cardIndex);
  }

  function revealFace(cardIndex: number, faceIndex: number) {
    setCards((current) => {
      const card = current[cardIndex];
      const skin = card?.faces[faceIndex];

      // A face only takes over if it is holding the skin this card is meant
      // to be showing. The face that just crossfaded out still has its old
      // image mounted, and a re-fired load on it would otherwise drag the
      // card back to a skin already handed on to the spare pool.
      if (
        !card ||
        !skin ||
        card.active === faceIndex ||
        shown.current[cardIndex]?.skinUuid !== skin.skinUuid
      ) {
        return current;
      }

      const next = [...current];
      next[cardIndex] = { active: faceIndex, faces: card.faces };

      return next;
    });
  }

  // A short pool would repeat the same skin across the fan, which reads as a
  // rendering fault rather than a showcase.
  if (opening.length < CARD_COUNT) {
    return null;
  }

  return (
    <section
      aria-labelledby="riot-empty-showcase-heading"
      // No panel around it: the fan holds the gap on its own, so a surface
      // here would only add a second box between two real ones.
      className="py-6 sm:py-8"
    >
      <header className="flex flex-col items-center gap-1.5 text-center">
        <span aria-hidden="true" className="skin-fan-spark">
          ✦
        </span>
        <h2 className="eyebrow" id="riot-empty-showcase-heading">
          Your next favourite skin is waiting
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">
          Connect your Riot account to unlock your personalised daily store.
        </p>
      </header>

      <div aria-hidden="true" className="skin-fan">
        {cards.map((card, cardIndex) => (
          <div
            className="skin-fan-card"
            data-featured={cardIndex === FEATURED_INDEX}
            onMouseEnter={() => {
              swapOnHover(cardIndex);
            }}
            // Cards are fixed slots in the fan, not a list that reorders; the
            // slot is the identity.
            key={cardIndex}
            style={
              {
                "--fan-depth": String(Math.abs(cardIndex - FEATURED_INDEX)),
                "--fan-index": String(cardIndex),
                "--fan-offset": String(cardIndex - FEATURED_INDEX),
              } as CSSProperties
            }
          >
            {card.faces.map((skin, faceIndex) => {
              if (!skin) {
                return null;
              }

              const [name, weapon] = splitSkinName(skin.displayName);

              return (
                <div
                  className="skin-fan-face"
                  data-active={card.active === faceIndex}
                  key={faceIndex}
                >
                  <span className="skin-fan-art">
                    <Image
                      alt=""
                      className="object-contain"
                      fill
                      key={skin.skinUuid}
                      onLoad={(event) => {
                        const image = event.currentTarget;

                        if (image.naturalWidth === image.naturalHeight) {
                          retireArtless(cardIndex, skin);
                          return;
                        }

                        revealFace(cardIndex, faceIndex);
                      }}
                      sizes="200px"
                      src={skin.displayIcon}
                    />
                  </span>
                  <span className="skin-fan-label">
                    <span className="skin-fan-name">{name}</span>
                    {weapon ? (
                      <span className="skin-fan-weapon">{weapon}</span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
