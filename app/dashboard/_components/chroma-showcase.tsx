"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import Image from "next/image";
import { useState } from "react";

import type { ChromaView } from "@/src/types/catalog-view";

interface ChromaShowcaseProps {
  readonly chromas: readonly ChromaView[];
  readonly fallbackRender: string | null;
  readonly skinUuid: string;
  /** 8 hex chars RGBA, no leading #. */
  readonly tierColor: string | null;
}

/**
 * The hero render plus the VARIANTS swatch row. Selecting a swatch crossfades
 * the hero to that chroma's render; skins without chroma art fall back to the
 * base render, and skins with no art at all show a placeholder glyph.
 */
export function ChromaShowcase({
  chromas,
  fallbackRender,
  skinUuid,
  tierColor,
}: ChromaShowcaseProps) {
  const [selected, setSelected] = useState(0);

  const current = chromas[selected];
  const art = current?.fullRender ?? fallbackRender;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col gap-6">
        <div
          className="relative h-64 md:h-80"
          style={{ viewTransitionName: `skin-${skinUuid}` }}
        >
          {/* Soft tier-colored glow behind the weapon. */}
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-1/2 h-40 w-3/4 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-3xl"
            style={{
              backgroundColor: tierColor ? `#${tierColor}` : undefined,
            }}
          />
          <AnimatePresence initial={false}>
            <motion.div
              animate={{ opacity: 1 }}
              className="absolute inset-0"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key={current?.chromaUuid ?? "base"}
              transition={{ duration: 0.25 }}
            >
              {art ? (
                <Image
                  alt=""
                  className="object-contain"
                  fill
                  sizes="(min-width: 768px) 640px, 100vw"
                  src={art}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-full items-center justify-center text-4xl text-ink-dim"
                >
                  V
                </span>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {chromas.length > 1 ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-xs! tracking-[0.25em] text-ink-dim">
              VARIANTS
            </h2>
            <div className="flex flex-wrap gap-2">
              {chromas.map((chroma, index) => (
                <button
                  aria-label={chroma.variantLabel ?? "Base"}
                  aria-pressed={index === selected}
                  className={`h-12 w-12 cursor-pointer overflow-hidden rounded-chip border border-line bg-bg-inset transition-colors hocus:border-white/25 ${
                    index === selected ? "ring-2 ring-accent" : ""
                  }`}
                  key={chroma.chromaUuid}
                  onClick={() => setSelected(index)}
                  type="button"
                >
                  {chroma.swatch ? (
                    <Image
                      alt=""
                      className="h-full w-full object-cover"
                      height={48}
                      src={chroma.swatch}
                      width={48}
                    />
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </MotionConfig>
  );
}
