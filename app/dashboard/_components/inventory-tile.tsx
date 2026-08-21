"use client";

import Image from "next/image";

import { TransitionLink } from "@/app/dashboard/_components/transition-link";
import type { InventoryTileView } from "@/src/types/catalog-view";

interface InventoryTileProps {
  readonly tile: InventoryTileView;
}

/**
 * A buy-menu cell: the weapon silhouette is the subject, its name sits along
 * the bottom edge, and the watch count takes the slot the game gives the
 * price. Watched weapons carry the selected-state ring the buy menu uses for
 * what you already own -- in this palette a white rail rather than a hue.
 */
export function InventoryTile({ tile }: InventoryTileProps) {
  const watched = tile.watchedCount > 0;

  return (
    <TransitionLink
      className={`group relative flex aspect-[2/1] w-full flex-col justify-between overflow-hidden rounded-chip border p-2 text-ink! no-underline transition-colors ${
        watched
          ? "border-white/35 bg-white/[0.07]"
          : "border-line-soft bg-white/[0.025] hocus:border-white/25 hocus:bg-white/[0.05]"
      }`}
      href={`/dashboard/inventory/${tile.weaponUuid}`}
    >
      {watched ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[2px] bg-white/60"
        />
      ) : null}

      {/* The buy menu puts the price here. A bare numeral is meaningless to a
          screen reader, so the count carries its own wording. */}
      {watched ? (
        <span className="self-end text-[10px] font-semibold tracking-wider text-ink-dim tabular-nums">
          <span aria-hidden="true">{tile.watchedCount}</span>
          <span className="sr-only">
            {tile.watchedCount} skins watched
          </span>
        </span>
      ) : (
        <span aria-hidden="true" className="text-[10px]">
          &nbsp;
        </span>
      )}

      <div
        className="relative mx-auto h-full w-[88%] flex-1"
        // Groundwork for the Phase I shared-element morph.
        style={{ viewTransitionName: `skin-${tile.weaponUuid}` }}
      >
        {tile.displayIcon ? (
          <Image
            alt={tile.displayName}
            className="object-contain transition-transform duration-move ease-out motion-safe:group-hover:scale-105"
            fill
            sizes="220px"
            src={tile.displayIcon}
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-full items-center justify-center text-xl text-ink-dim"
          >
            V
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold tracking-wide uppercase">
          {tile.displayName}
        </p>
        <p className="truncate text-[10px] text-ink-dim">
          {watched ? tile.watchedSkinName : "Not watched"}
        </p>
      </div>
    </TransitionLink>
  );
}
