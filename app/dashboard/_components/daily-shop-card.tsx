"use client";

import Image from "next/image";
import type { PointerEvent } from "react";
import { useState } from "react";

import { prefersReducedMotion } from "@/src/lib/motion/reduced-motion";

/**
 * Local shape for a daily offer. The canonical DailyShopOffer lives in a
 * server-only module, so this client leaf declares its own view props.
 */
interface DailyShopCardOffer {
  readonly displayIcon: string | null;
  readonly displayName: string;
  readonly skinUuid: string;
  readonly watched: boolean;
}

interface DailyShopCardProps {
  readonly offer: DailyShopCardOffer;
}

const MAX_TILT_DEGREES = 7;

export function DailyShopCard({ offer }: DailyShopCardProps) {
  const [tilt, setTilt] = useState<string>();

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    if (prefersReducedMotion()) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();

    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }

    // Pointer offset from the card centre, each axis in [-0.5, 0.5].
    const offsetX = (event.clientX - bounds.left) / bounds.width - 0.5;
    const offsetY = (event.clientY - bounds.top) / bounds.height - 0.5;
    const rotateX = (-offsetY * MAX_TILT_DEGREES * 2).toFixed(2);
    const rotateY = (offsetX * MAX_TILT_DEGREES * 2).toFixed(2);

    setTilt(`perspective(40rem) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`);
  }

  return (
    <article
      className="group relative flex aspect-[3/4] w-44 flex-col overflow-hidden rounded-card border border-line bg-bg-card shadow-panel md:w-52"
      onPointerLeave={() => setTilt(undefined)}
      onPointerMove={handlePointerMove}
      style={{ transform: tilt, transition: "transform 150ms ease" }}
    >
      <div className="relative m-3 flex-1">
        {offer.displayIcon ? (
          <Image
            alt=""
            className="object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.55)] transition-transform motion-safe:group-hover:scale-105"
            fill
            sizes="208px"
            src={offer.displayIcon}
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-full items-center justify-center text-3xl text-ink-dim"
          >
            V
          </span>
        )}
      </div>

      <div className="flex flex-col items-start gap-1.5 px-3 pb-3">
        <h3 className="w-full truncate text-sm! font-medium" title={offer.displayName}>
          {offer.displayName}
        </h3>
        {offer.watched ? (
          <p className="rounded-full bg-mint-dim px-2 py-0.5 text-[10px] tracking-wider text-mint uppercase">
            On your watchlist
          </p>
        ) : null}
      </div>

      {/* Sheen sweep across the card face on hover. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-linear-to-r from-transparent via-white/10 to-transparent bg-[length:250%_100%] opacity-0 group-hover:opacity-100 motion-safe:group-hover:animate-sheen"
      />
    </article>
  );
}
