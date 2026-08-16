"use client";

import Image from "next/image";

import { TransitionLink } from "@/app/dashboard/_components/transition-link";
import type { InventoryTileView } from "@/src/types/catalog-view";

interface InventoryTileProps {
  readonly tile: InventoryTileView;
}

export function InventoryTile({ tile }: InventoryTileProps) {
  const watched = tile.watchedCount > 0;

  return (
    <TransitionLink
      className={`flex flex-col gap-2 rounded-card border ${
        watched ? "border-mint/40" : "border-line"
      } bg-bg-card p-3 text-ink! no-underline transition-all hocus:-translate-y-0.5 hocus:border-white/25`}
      href={`/dashboard/inventory/${tile.weaponUuid}`}
    >
      <div
        className="relative h-20"
        // Groundwork for the Phase I shared-element morph.
        style={{ viewTransitionName: `skin-${tile.weaponUuid}` }}
      >
        {tile.displayIcon ? (
          <Image
            alt={tile.displayName}
            className="object-contain"
            fill
            sizes="208px"
            src={tile.displayIcon}
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

      <p className="text-sm font-medium">{tile.displayName}</p>

      {watched ? (
        <p className="flex items-center gap-2 text-xs text-mint">
          <span className="truncate">{tile.watchedSkinName}</span>
          {tile.watchedCount > 1 ? (
            <span className="shrink-0 rounded-full bg-mint-dim px-1.5 py-0.5 text-[10px]">
              +{tile.watchedCount - 1} more
            </span>
          ) : null}
        </p>
      ) : (
        <p className="text-xs text-ink-dim">No skins watched</p>
      )}
    </TransitionLink>
  );
}
