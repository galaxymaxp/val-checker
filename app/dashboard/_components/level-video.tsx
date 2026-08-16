"use client";

import { useState } from "react";

interface LevelVideoProps {
  readonly poster?: string | null;
  readonly src: string;
  readonly title: string;
}

/**
 * Click-to-play preview for a level's streamed video. The files are multi-MB
 * MP4s, so nothing is mounted (let alone fetched) until the user asks: the
 * button only reveals a `preload="none"` player, and playback itself starts
 * from the native controls.
 */
export function LevelVideo({ poster, src, title }: LevelVideoProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <button
        className="w-fit cursor-pointer rounded-chip border border-line px-3 py-1 text-xs transition-colors hocus:border-white/25"
        onClick={() => setRevealed((value) => !value)}
        type="button"
      >
        {revealed ? "Hide preview" : "Play preview"}
      </button>

      {revealed ? (
        <video
          aria-label={title}
          className="w-full rounded-card border border-line"
          controls
          poster={poster ?? undefined}
          preload="none"
          src={src}
        />
      ) : null}
    </div>
  );
}
