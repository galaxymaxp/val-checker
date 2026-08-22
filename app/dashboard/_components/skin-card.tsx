"use client";

import Image from "next/image";
import { useState } from "react";

import { TransitionLink } from "@/app/dashboard/_components/transition-link";
import type { WeaponSkinRowView } from "@/src/types/catalog-view";
import type { WatchMutationResult } from "@/src/types/watchlist";

interface SkinCardProps {
  readonly connectionId: string;
  readonly skin: WeaponSkinRowView;
  readonly updateWatch: (
    skinUuid: string,
    watched: boolean,
  ) => Promise<WatchMutationResult>;
  readonly weaponUuid: string;
}

export function SkinCard({ connectionId, skin, updateWatch, weaponUuid }: SkinCardProps) {
  // Optimistic toggle with rollback, mirroring the collection browser.
  const [watched, setWatched] = useState(skin.watched);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggleWatched() {
    if (pending) {
      return;
    }

    const nextWatched = !watched;
    setFailed(false);
    setWatched(nextWatched);
    setPending(true);

    try {
      const result = await updateWatch(skin.skinUuid, nextWatched);

      if (!result.ok) {
        throw new Error(result.error);
      }
    } catch {
      setWatched(!nextWatched);
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  const art = skin.displayIcon ?? skin.fullRender;
  const tierColor = skin.tier?.highlightColor
    ? `#${skin.tier.highlightColor}`
    : undefined;

  return (
    <article className="relative flex h-full flex-col gap-2 overflow-hidden rounded-card border border-line bg-bg-card p-3 pl-4">
      {/* Tier rail down the left edge, tinted with the tier highlight. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px] bg-line"
        style={{ backgroundColor: tierColor }}
      />

      {/* The art and name open the skin's detail page; the watch toggle
          stays a sibling so no interactive element nests inside the link. */}
      <TransitionLink
        className="flex flex-col gap-2 text-ink! no-underline"
        href={`/dashboard/inventory/${weaponUuid}/${skin.skinUuid}?account=${encodeURIComponent(connectionId)}`}
      >
        <div
          className="relative h-24"
          // Pairs with the detail page hero for the tile→detail morph.
          style={{ viewTransitionName: `skin-${skin.skinUuid}` }}
        >
          {art ? (
            <Image
              alt={skin.displayName}
              className="object-contain"
              fill
              sizes="176px"
              src={art}
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-full items-center justify-center text-2xl text-ink-dim"
            >
              V
            </span>
          )}
        </div>

        <h3 className="text-sm! font-medium">{skin.displayName}</h3>
      </TransitionLink>

      <p
        className="w-fit rounded-full bg-bg-inset px-2 py-0.5 text-[10px] tracking-wider text-ink-muted uppercase"
        style={
          tierColor
            ? {
                backgroundColor: `color-mix(in srgb, ${tierColor} 18%, transparent)`,
              }
            : undefined
        }
      >
        {skin.tier?.displayName ?? "Standard"}
      </p>

      <button
        aria-label={`${watched ? "Stop watching" : "Watch"} ${skin.displayName}`}
        aria-pressed={watched}
        className={`mt-auto min-h-9 w-fit cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
          watched
            ? "border-transparent bg-accent text-bg!"
            : "border-line hocus:border-white/25"
        }`}
        disabled={pending}
        onClick={toggleWatched}
        type="button"
      >
        {pending ? "Saving…" : watched ? "Watched" : "Watch"}
      </button>

      {failed ? (
        <p className="text-xs text-amber" role="alert">
          That change did not save.
        </p>
      ) : null}
    </article>
  );
}
