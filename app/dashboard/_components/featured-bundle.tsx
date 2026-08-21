import Image from "next/image";

interface FeaturedBundleItem {
  readonly displayIcon: string | null;
  readonly displayName: string;
  readonly price: number | null;
  readonly skinUuid: string;
}

interface FeaturedBundleProps {
  readonly bundle: {
    readonly displayIcon: string | null;
    readonly displayName: string | null;
    readonly expiresAt: string;
    readonly items: readonly FeaturedBundleItem[];
    readonly otherItemCount: number;
    readonly totalBaseCost: number | null;
    readonly totalDiscountedCost: number | null;
    readonly totalDiscountPercent: number;
  };
}

function formatPrice(value: number | null): string | null {
  return typeof value === "number" ? value.toLocaleString() : null;
}

/**
 * The bundle is a piece of key art, so it is shown as one: the artwork fills
 * the panel and the metadata sits on top of it, behind a scrim heavy enough to
 * hold text at contrast. Falls back to a plain surface when no art resolves,
 * since the prices are worth showing on their own.
 */
export function FeaturedBundle({ bundle }: FeaturedBundleProps) {
  const price = formatPrice(bundle.totalDiscountedCost);
  const wasPrice = formatPrice(bundle.totalBaseCost);
  const discounted =
    bundle.totalDiscountPercent > 0 &&
    bundle.totalBaseCost !== bundle.totalDiscountedCost;
  const leaves = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(bundle.expiresAt));

  return (
    <section
      aria-labelledby="featured-bundle-heading"
      className="relative isolate flex min-h-64 flex-col justify-end overflow-hidden rounded-panel border border-line bg-bg-card shadow-panel sm:aspect-[5/2] lg:aspect-[16/5]"
    >
      {bundle.displayIcon ? (
        <>
          <Image
            alt=""
            className="-z-10 object-cover"
            fill
            priority={false}
            sizes="(min-width: 1440px) 1440px, 100vw"
            src={bundle.displayIcon}
          />
          {/* Scrim: dark at the base where the text sits, clear at the top so
              the art still reads as art. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-gradient-to-t from-[#08090b] via-[#08090b]/70 to-transparent"
          />
        </>
      ) : null}

      <div className="flex flex-col gap-3 p-5 sm:p-6">
        <div>
          <p className="eyebrow">FEATURED BUNDLE</p>
          <h2 className="text-2xl!" id="featured-bundle-heading">
            {bundle.displayName ?? "Featured bundle"}
          </h2>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {price ? (
            <span className="text-lg font-semibold">{price} VP</span>
          ) : null}
          {discounted && wasPrice ? (
            <span className="text-sm text-ink-dim line-through">
              {wasPrice} VP
            </span>
          ) : null}
          {discounted ? (
            <span className="rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-xs font-semibold backdrop-blur-sm">
              −{Math.round(bundle.totalDiscountPercent * 100)}%
            </span>
          ) : null}
          <span className="text-xs text-ink-muted">
            Leaves <time dateTime={bundle.expiresAt}>{leaves}</time>
          </span>
        </div>

        {bundle.items.length > 0 || bundle.otherItemCount > 0 ? (
          <ul className="flex flex-wrap gap-2" role="list">
            {bundle.items.map((item) => (
              <li
                className="flex min-w-0 items-center gap-2 rounded-full border border-white/15 bg-black/40 py-1 pr-3 pl-1 backdrop-blur-sm"
                key={item.skinUuid}
              >
                {item.displayIcon ? (
                  <span className="relative h-5 w-10 shrink-0">
                    <Image
                      alt=""
                      className="object-contain"
                      fill
                      sizes="40px"
                      src={item.displayIcon}
                    />
                  </span>
                ) : null}
                <span className="truncate text-xs text-ink-muted">
                  {item.displayName}
                </span>
              </li>
            ))}
            {/* Kept even when nothing resolved: an unsynced catalog should not
                make the bundle look emptier than it is. */}
            {bundle.otherItemCount > 0 ? (
              <li className="flex items-center rounded-full border border-white/15 bg-black/40 px-3 py-1 text-xs text-ink-muted backdrop-blur-sm">
                +{bundle.otherItemCount} more
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
