"use client";

import { useDeferredValue, useId, useMemo, useState } from "react";

import { SkinCard } from "@/app/dashboard/_components/skin-card";
import type { WeaponSkinRowView } from "@/src/types/catalog-view";
import type { WatchMutationResult } from "@/src/types/watchlist";

/** Rows revealed per press. The filter always searches the full list. */
const REVEAL_STEP = 60;

/**
 * VALORANT gives battlepass, event, agent-recruitment, and default skins no
 * content tier at all, so "no edition" is the bucket a player means when they
 * ask to hide battlepass skins.
 */
const UNTIERED_KEY = "untiered";
const UNTIERED_LABEL = "No edition";

interface SkinSearchGridProps {
  readonly connectionId: string;
  readonly skins: readonly WeaponSkinRowView[];
  readonly updateWatch: (
    skinUuid: string,
    watched: boolean,
  ) => Promise<WatchMutationResult>;
  readonly weaponName: string;
  readonly weaponUuid: string;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().trim();
}

function tierKey(skin: WeaponSkinRowView): string {
  return skin.tier?.contentTierUuid ?? UNTIERED_KEY;
}

export function SkinSearchGrid({
  connectionId,
  skins,
  updateWatch,
  weaponName,
  weaponUuid,
}: SkinSearchGridProps) {
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [revealed, setRevealed] = useState(REVEAL_STEP);
  const deferredQuery = useDeferredValue(query);
  const searchId = useId();

  // Editions are ordered by the catalog's own tier rank, with the untiered
  // bucket last, so the chips read Select → Exclusive regardless of load order.
  const editions = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; rank: number }>();
    for (const skin of skins) {
      const key = tierKey(skin);
      if (!seen.has(key)) {
        seen.set(key, {
          key,
          label: skin.tier?.displayName ?? UNTIERED_LABEL,
          rank: skin.tier?.rank ?? Number.MAX_SAFE_INTEGER,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.rank - b.rank);
  }, [skins]);

  const matches = useMemo(() => {
    const needle = normalize(deferredQuery);
    return skins.filter((skin) => {
      if (hidden.includes(tierKey(skin))) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return (
        normalize(skin.displayName).includes(needle) ||
        normalize(skin.tier?.displayName ?? "").includes(needle)
      );
    });
  }, [deferredQuery, hidden, skins]);

  const visible = matches.slice(0, revealed);
  const remaining = matches.length - visible.length;

  function toggleEdition(key: string) {
    setRevealed(REVEAL_STEP);
    setHidden((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key],
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label
            className="flex min-w-0 flex-1 flex-col gap-1"
            htmlFor={searchId}
          >
            <span className="sr-only">Search {weaponName} skins</span>
            <input
              autoComplete="off"
              className="w-full max-w-sm rounded-full border border-line bg-bg-inset px-4 py-2 text-sm text-ink placeholder:text-ink-dim focus-visible:border-white/70"
              id={searchId}
              onChange={(event) => {
                setQuery(event.target.value);
                // A narrowed list starts from the top again, so "Load more"
                // never leaves the reader past everything that still matches.
                setRevealed(REVEAL_STEP);
              }}
              placeholder={`Search ${weaponName} skins`}
              type="search"
              value={query}
            />
          </label>
          <p aria-live="polite" className="text-sm text-ink-dim" role="status">
            {matches.length} of {skins.length} shown
          </p>
        </div>

        {editions.length > 1 ? (
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">Filter by edition</legend>
            {editions.map((edition) => {
              const active = !hidden.includes(edition.key);
              return (
                <button
                  aria-pressed={active}
                  className={`inline-flex min-h-8 cursor-pointer items-center rounded-full border px-3 text-xs font-semibold ${
                    active
                      ? "border-white/50 bg-white/10 text-ink"
                      : "border-line-soft text-ink-dim line-through"
                  }`}
                  key={edition.key}
                  onClick={() => {
                    toggleEdition(edition.key);
                  }}
                  type="button"
                >
                  {edition.label}
                </button>
              );
            })}
          </fieldset>
        ) : null}
      </div>

      {matches.length === 0 ? (
        <p className="text-ink-muted">
          No {weaponName} skin matches the current search and filters.
        </p>
      ) : (
        <>
          <ul
            className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]"
            role="list"
          >
            {visible.map((skin) => (
              <li
                className="[contain-intrinsic-size:0_220px] [content-visibility:auto]"
                key={skin.skinUuid}
              >
                <SkinCard
                  connectionId={connectionId}
                  skin={skin}
                  updateWatch={updateWatch}
                  weaponUuid={weaponUuid}
                />
              </li>
            ))}
          </ul>

          {remaining > 0 ? (
            <button
              className="inline-flex min-h-11 w-fit cursor-pointer items-center justify-center self-center rounded-full border border-line px-5 text-sm font-semibold text-ink hocus:border-white/50 hocus:bg-white/5"
              onClick={() => {
                setRevealed((current) => current + REVEAL_STEP);
              }}
              type="button"
            >
              Load {Math.min(REVEAL_STEP, remaining)} more
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
