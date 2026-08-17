import Image from "next/image";
import type { CSSProperties } from "react";

/**
 * Local shape for a daily offer. The canonical DailyShopOffer lives in a
 * server-only module, so this client leaf declares its own view props.
 */
interface DailyShopCardOffer {
  readonly displayIcon: string | null;
  readonly displayName: string;
  readonly price?: number | null;
  readonly skinUuid: string;
  readonly tierName?: string | null;
  readonly watched: boolean;
  readonly weaponName?: string | null;
}

interface DailyShopCardProps {
  readonly offer: DailyShopCardOffer;
}

/**
 * Riot ships tier names as display strings ("Premium Edition"), so match on a
 * normalized substring rather than an exact label. Anything unrecognised —
 * including a brand-new tier — falls back to the monochrome accent, which is
 * why an unsynced catalog degrades quietly instead of losing the rail.
 */
function tierAccentVar(tierName: string | null | undefined): string {
  const tier = tierName?.toLowerCase() ?? "";

  if (tier.includes("exclusive")) return "var(--tier-exclusive)";
  if (tier.includes("ultra")) return "var(--tier-ultra)";
  if (tier.includes("premium")) return "var(--tier-premium)";
  if (tier.includes("deluxe")) return "var(--tier-deluxe)";
  if (tier.includes("select")) return "var(--tier-select)";
  return "var(--tier-unknown)";
}

export function DailyShopCard({ offer }: DailyShopCardProps) {
  const tierStyle = { "--tier": tierAccentVar(offer.tierName) } as CSSProperties;

  return (
    <article
      className="group relative flex h-full min-h-88 w-full min-w-0 flex-col overflow-hidden rounded-card border border-line bg-bg-card shadow-panel transition-transform duration-2 ease-out motion-safe:hocus-within:-translate-y-1"
      style={tierStyle}
    >
      {/* Gallery wash: the tier reads as light falling on the piece, not as a
          swatch. Sits under the artwork and above the card surface. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-3/5 opacity-70 transition-opacity duration-3 ease-out group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(115% 78% at 50% 0%, rgb(var(--tier) / 0.16), transparent 72%)",
        }}
      />

      {/* Artwork is the subject: it gets the majority of the card and scales
          on hover, while the plinth below stays fixed so text never shifts. */}
      <div className="relative m-4 min-h-56 flex-1 sm:min-h-64">
        {offer.displayIcon ? (
          <Image
            alt=""
            className="object-contain drop-shadow-[0_14px_26px_rgba(0,0,0,0.6)] transition-transform duration-3 ease-out motion-safe:group-hover:scale-[1.06]"
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 22vw"
            src={offer.displayIcon}
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-full items-center justify-center text-4xl text-ink-dim"
          >
            V
          </span>
        )}

        {offer.watched ? (
          <p className="absolute top-0 right-0 rounded-full border border-line-soft bg-bg-inset/90 px-2.5 py-1 text-[10px] tracking-wider text-ink uppercase backdrop-blur-sm">
            On your watchlist
          </p>
        ) : null}
      </div>

      {/* Plinth: precise but secondary. Name leads, everything else recedes. */}
      <div className="relative flex flex-col gap-2 border-t border-line-soft bg-bg-inset/40 px-4 py-3.5">
        <div className="w-full min-w-0">
          <p className="truncate text-[11px] tracking-wider text-ink-dim uppercase">
            {offer.weaponName ?? "Weapon skin"}
          </p>
          <h3
            className="w-full truncate text-base! font-semibold"
            title={offer.displayName}
          >
            {offer.displayName}
          </h3>
        </div>
        <div className="flex w-full flex-wrap items-baseline justify-between gap-2 text-xs">
          <span className="truncate text-ink-muted">
            {offer.tierName ?? "Tier pending"}
          </span>
          {typeof offer.price === "number" ? (
            <span className="font-semibold tabular-nums text-ink">
              {offer.price.toLocaleString()} VP
            </span>
          ) : null}
        </div>
      </div>

      {/* Hairline tier rail along the base — the collector cue. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgb(var(--tier) / 0.75), transparent)",
        }}
      />
    </article>
  );
}
