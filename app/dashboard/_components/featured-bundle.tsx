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

export function FeaturedBundle({ bundle }: FeaturedBundleProps) {
  const price = formatPrice(bundle.totalDiscountedCost);
  const wasPrice = formatPrice(bundle.totalBaseCost);
  const discounted =
    bundle.totalDiscountPercent > 0 &&
    bundle.totalBaseCost !== bundle.totalDiscountedCost;

  return (
    <section
      aria-labelledby="featured-bundle-heading"
      className="overflow-hidden rounded-panel border border-line bg-bg-card shadow-panel"
    >
      <div className="flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-center">
        {bundle.displayIcon ? (
          <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-card lg:h-44 lg:w-72">
            <Image
              alt=""
              className="object-cover"
              fill
              sizes="(min-width: 1024px) 18rem, 100vw"
              src={bundle.displayIcon}
            />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <p className="eyebrow">FEATURED BUNDLE</p>
            <h2 className="text-xl!" id="featured-bundle-heading">
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
              <span className="rounded-full border border-line-soft px-2 py-0.5 text-xs font-semibold text-ink-muted">
                −{Math.round(bundle.totalDiscountPercent * 100)}%
              </span>
            ) : null}
            <span className="text-xs text-ink-dim">
              Leaves{" "}
              <time dateTime={bundle.expiresAt}>
                {new Intl.DateTimeFormat("en-US", {
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                }).format(new Date(bundle.expiresAt))}
              </time>
            </span>
          </div>

          {bundle.items.length > 0 ? (
            <ul
              className="flex flex-wrap gap-3"
              role="list"
            >
              {bundle.items.map((item) => (
                <li
                  className="flex min-w-0 items-center gap-2 rounded-card border border-line-soft bg-bg-inset p-2 pr-3"
                  key={item.skinUuid}
                >
                  {item.displayIcon ? (
                    <span className="relative h-8 w-14 shrink-0">
                      <Image
                        alt=""
                        className="object-contain"
                        fill
                        sizes="56px"
                        src={item.displayIcon}
                      />
                    </span>
                  ) : null}
                  <span className="truncate text-xs text-ink-muted">
                    {item.displayName}
                  </span>
                </li>
              ))}
              {bundle.otherItemCount > 0 ? (
                <li className="flex items-center rounded-card border border-line-soft bg-bg-inset px-3 text-xs text-ink-dim">
                  +{bundle.otherItemCount} more
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
