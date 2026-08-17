import Link from "next/link";

import { DailyShopCard } from "@/app/dashboard/_components/daily-shop-card";
import type { DailyShopView } from "@/src/lib/storefront/daily-shop";

interface DailyShopStageProps {
  readonly accountLabel?: string | null;
  readonly connected: boolean;
  readonly shop: DailyShopView | null;
}

const MILLISECONDS_PER_HOUR = 3_600_000;

/** Coarse server-rendered countdown; the page revalidates often enough. */
function endsInLabel(expiresAt: string | null | undefined): string {
  if (!expiresAt) {
    return "ROTATES DAILY";
  }

  const remaining = new Date(expiresAt).getTime() - Date.now();

  if (!Number.isFinite(remaining) || remaining <= 0) {
    return "NEW SHOP SOON";
  }

  const hours = Math.ceil(remaining / MILLISECONDS_PER_HOUR);
  return hours <= 1 ? "ENDS WITHIN THE HOUR" : `ENDS IN ${hours} HOURS`;
}

function formatRotation(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
}

function formatCheckedTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The pinned cinematic stage: one offer row per connected account, layered
 * over slow-breathing gradient plates. The page wraps this and the inventory
 * grid in one `relative` container, so `sticky top-0` here pins the stage
 * while the grid (relative z-10 bg-bg) scrolls up over it.
 */
export function DailyShopStage({
  accountLabel,
  connected,
  shop,
}: DailyShopStageProps) {
  const hasOffers = Boolean(shop && shop.offers.length > 0);

  return (
    <section
      aria-labelledby="todays-store-heading"
      className="relative flex flex-col gap-8 overflow-hidden rounded-panel border border-line bg-bg-card px-4 py-8 shadow-panel sm:px-8 sm:py-10"
    >
      {/* Atmosphere: two blurred gradient plates, breathing via shop-glow. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[60rem] max-w-none -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(255,255,255,0.10),transparent_70%)] blur-2xl motion-safe:animate-[shop-glow_9s_ease-in-out_infinite_alternate]" />
        <div className="absolute -right-24 -bottom-24 h-[28rem] w-[44rem] bg-[radial-gradient(closest-side,rgba(255,255,255,0.06),transparent_70%)] blur-2xl motion-safe:animate-[shop-glow_12s_ease-in-out_infinite_alternate-reverse]" />
      </div>

      <header className="relative flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="eyebrow">TODAY&apos;S STORE</p>
          <h2 id="todays-store-heading">
            {accountLabel ? `${accountLabel}’s daily offers` : "Daily offers"}
          </h2>
        </div>
        <p className="rounded-full border border-line bg-bg-inset px-3 py-1 text-[11px] tracking-wider text-ink-muted">
          {endsInLabel(shop?.expiresAt)}
        </p>
      </header>

      {hasOffers ? (
        <div className="relative space-y-5">
          <ul
            className="grid grid-cols-2 items-stretch gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5"
            role="list"
          >
            {shop!.offers.map((offer, index) => (
              <li className="min-w-0" key={`${offer.skinUuid}-${index}`}>
                <DailyShopCard offer={offer} />
              </li>
            ))}
          </ul>
          {/* Gallery caption: provenance for the row above, deliberately quiet. */}
          <p className="border-t border-line-soft pt-4 text-xs text-ink-muted">
            {formatRotation(shop!.rotationDate)} · {shop!.offers.length} offers ·
            checked {formatCheckedTime(shop!.checkedAt)}
          </p>
        </div>
      ) : (
        <div className="relative flex min-h-64 flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line p-8 text-center">
          <p className="max-w-md text-ink-muted">
            {connected
              ? "No store has been recorded for this account yet. Its automatic refresh runs just after 00:00 UTC; check the store status above for today’s manual-refresh availability."
              : "Reconnect this Riot account to resume automatic and manual storefront refreshes."}
          </p>
          <Link
            className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm text-ink-muted! no-underline hocus:text-ink!"
            href="/dashboard/connection"
          >
            Manage Riot accounts
          </Link>
        </div>
      )}
    </section>
  );
}
