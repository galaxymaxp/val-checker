import Image from "next/image";

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

export function DailyShopCard({ offer }: DailyShopCardProps) {
  return (
    <article
      className="group relative flex min-h-72 w-full min-w-0 flex-col overflow-hidden rounded-card border border-line bg-bg-card shadow-panel transition-transform motion-safe:hocus:-translate-y-1"
    >
      <div className="relative m-3 min-h-44 flex-1 sm:min-h-52">
        {offer.displayIcon ? (
          <Image
            alt=""
            className="object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.55)] transition-transform motion-safe:group-hover:scale-105"
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 22vw"
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

      <div className="flex flex-col items-start gap-2 border-t border-line-soft px-4 py-3">
        <div className="w-full min-w-0">
          <p className="truncate text-[11px] tracking-wider text-ink-dim uppercase">
            {offer.weaponName ?? "Weapon skin"}
          </p>
          <h3 className="w-full truncate text-sm! font-semibold" title={offer.displayName}>
          {offer.displayName}
          </h3>
        </div>
        <div className="flex w-full flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-ink-muted">{offer.tierName ?? "Tier pending"}</span>
          {typeof offer.price === "number" ? (
            <span className="font-semibold tabular-nums text-ink">
              {offer.price.toLocaleString()} VP
            </span>
          ) : null}
        </div>
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
