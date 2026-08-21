import Image from "next/image";

interface NightMarketOffer {
  readonly basePrice: number | null;
  readonly discountPercent: number;
  readonly discountedPrice: number | null;
  readonly displayIcon: string | null;
  readonly displayName: string;
  readonly skinUuid: string | null;
  readonly watched: boolean;
  readonly weaponName: string | null;
}

interface NightMarketProps {
  readonly nightMarket: {
    readonly expiresAt: string;
    readonly offers: readonly NightMarketOffer[];
  };
}

/**
 * Shown only while Riot is running a night market, which is a handful of weeks
 * a year. Everything here reads from the same stored check as the daily shop,
 * so it costs no extra Riot request.
 */
export function NightMarket({ nightMarket }: NightMarketProps) {
  if (nightMarket.offers.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="night-market-heading"
      className="flex flex-col gap-4 rounded-panel border border-line bg-bg-card p-5 shadow-panel sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow">NIGHT MARKET</p>
          <h2 className="text-xl!" id="night-market-heading">
            {nightMarket.offers.length} discounted{" "}
            {nightMarket.offers.length === 1 ? "skin" : "skins"}
          </h2>
        </div>
        <span className="text-xs text-ink-dim">
          Closes{" "}
          <time dateTime={nightMarket.expiresAt}>
            {new Intl.DateTimeFormat("en-US", {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            }).format(new Date(nightMarket.expiresAt))}
          </time>
        </span>
      </div>

      <ul
        className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]"
        role="list"
      >
        {nightMarket.offers.map((offer, index) => (
          <li
            className="flex flex-col gap-3 rounded-card border border-line-soft bg-bg-inset p-3"
            key={offer.skinUuid ?? `night-market-${index}`}
          >
            <div className="relative h-20">
              {offer.displayIcon ? (
                <Image
                  alt=""
                  className="object-contain"
                  fill
                  sizes="208px"
                  src={offer.displayIcon}
                />
              ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="truncate text-sm font-semibold" title={offer.displayName}>
                {offer.displayName}
              </p>
              {offer.weaponName ? (
                <p className="text-xs text-ink-dim">{offer.weaponName}</p>
              ) : null}
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {typeof offer.discountedPrice === "number" ? (
                  <span className="text-sm font-semibold">
                    {offer.discountedPrice.toLocaleString()} VP
                  </span>
                ) : null}
                {typeof offer.basePrice === "number" &&
                offer.basePrice !== offer.discountedPrice ? (
                  <span className="text-xs text-ink-dim line-through">
                    {offer.basePrice.toLocaleString()}
                  </span>
                ) : null}
                {offer.discountPercent > 0 ? (
                  <span className="rounded-full border border-line-soft px-2 text-[11px] font-semibold text-ink-muted">
                    −{Math.round(offer.discountPercent)}%
                  </span>
                ) : null}
              </div>
              {offer.watched ? (
                <p className="text-xs font-semibold text-ink">On your watchlist</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
