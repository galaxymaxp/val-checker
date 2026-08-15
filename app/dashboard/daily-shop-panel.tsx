import Image from "next/image";

import type { DailyShopView } from "@/src/lib/storefront/daily-shop";

interface DailyShopPanelProps {
  readonly connected: boolean;
  readonly shop: DailyShopView | null;
}

function formatRotation(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
}

export function DailyShopPanel({ connected, shop }: DailyShopPanelProps) {
  return (
    <section aria-label="Today's shop" className="daily-shop">
      <header className="daily-shop-heading">
        <div>
          <p className="eyebrow">TODAY&apos;S SHOP</p>
          <h2>{shop ? formatRotation(shop.rotationDate) : "Not checked yet"}</h2>
        </div>
        {shop ? (
          <p className="daily-shop-meta">
            {shop.offers.length} offers · checked{" "}
            {new Date(shop.checkedAt).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        ) : null}
      </header>

      {shop && shop.offers.length > 0 ? (
        <ul className="daily-shop-grid">
          {shop.offers.map((offer) => (
            <li
              className={`daily-shop-card${offer.watched ? " daily-shop-card--watched" : ""}`}
              key={offer.skinUuid}
            >
              <div className="skin-art">
                {offer.displayIcon ? (
                  <Image
                    alt=""
                    fill
                    sizes="(max-width: 720px) 45vw, 15vw"
                    src={offer.displayIcon}
                  />
                ) : (
                  <span aria-hidden="true">V</span>
                )}
              </div>
              <h3>{offer.displayName}</h3>
              {offer.watched ? <p className="daily-shop-hit">On your watchlist</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="daily-shop-empty">
          {connected
            ? "Your storefront is checked once a day, just after 00:00 UTC. The first result will appear here after the next run."
            : "Connect your Riot account to start seeing your daily storefront here."}
        </p>
      )}
    </section>
  );
}
