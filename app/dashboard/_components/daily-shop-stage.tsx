import Link from "next/link";

import { DailyShopCard } from "@/app/dashboard/_components/daily-shop-card";
import { DailyShopRefresh } from "@/app/dashboard/daily-shop-refresh";
import type { DailyShopView } from "@/src/lib/storefront/daily-shop";
import type { RiotConnectionMutationResult } from "@/src/types/riot-connection";

interface DailyShopStageProps {
  readonly checkNow?: () => Promise<RiotConnectionMutationResult>;
  readonly connected: boolean;
  readonly shops: readonly DailyShopView[];
  readonly todaysRotation: string;
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
  checkNow,
  connected,
  shops,
  todaysRotation,
}: DailyShopStageProps) {
  const stale = connected && shops[0]?.rotationDate !== todaysRotation;
  const hasOffers = shops.some((shop) => shop.offers.length > 0);

  return (
    <section
      aria-label="Today's shop"
      className="sticky top-0 flex min-h-dvh flex-col items-center justify-center gap-10 overflow-hidden px-4 py-16"
    >
      {/* Atmosphere: two blurred gradient plates, breathing via shop-glow. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[60rem] max-w-none -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(255,255,255,0.10),transparent_70%)] blur-2xl motion-safe:animate-[shop-glow_9s_ease-in-out_infinite_alternate]" />
        <div className="absolute -right-24 -bottom-24 h-[28rem] w-[44rem] bg-[radial-gradient(closest-side,rgba(255,255,255,0.06),transparent_70%)] blur-2xl motion-safe:animate-[shop-glow_12s_ease-in-out_infinite_alternate-reverse]" />
      </div>

      <header className="relative flex flex-col items-center gap-3 text-center">
        <h1 className="text-5xl! font-semibold tracking-[0.3em]! text-ink">
          DAILY
        </h1>
        <p className="text-xs tracking-widest text-ink-dim">
          {endsInLabel(shops[0]?.expiresAt)}
        </p>
      </header>

      {hasOffers ? (
        <div className="relative flex w-full flex-col items-center gap-12">
          {shops.map((shop, index) =>
            shop.offers.length > 0 ? (
              <div
                className="flex w-full flex-col items-center gap-4"
                key={shop.connectionId}
              >
                {shops.length > 1 ? (
                  <p className="rounded-full border border-line bg-bg-inset px-3 py-1 text-[10px] tracking-widest text-ink-dim uppercase">
                    {shop.label ?? `Account ${index + 1}`}
                  </p>
                ) : null}
                <ul className="flex flex-wrap justify-center gap-4">
                  {shop.offers.map((offer) => (
                    <li key={offer.skinUuid}>
                      <DailyShopCard offer={offer} />
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-ink-dim">
                  {formatRotation(shop.rotationDate)} · {shop.offers.length}{" "}
                  offers · checked {formatCheckedTime(shop.checkedAt)}
                </p>
              </div>
            ) : null,
          )}
        </div>
      ) : (
        <p className="relative max-w-md text-center text-ink-muted">
          {connected
            ? "Your storefront is checked once a day, just after 00:00 UTC. The first result will appear here after the next run."
            : "Connect your Riot account to start seeing your daily storefront here."}
        </p>
      )}

      <div className="relative flex flex-col items-center gap-2">
        {connected && checkNow ? (
          <DailyShopRefresh checkNow={checkNow} stale={stale} />
        ) : null}
        <Link
          className="text-sm text-ink-dim! no-underline transition-colors hocus:text-ink!"
          href="/dashboard/connection"
        >
          Manage your Riot connection
        </Link>
      </div>

      <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-1 text-ink-dim motion-safe:animate-bounce">
        <span className="text-xs tracking-widest">YOUR ARSENAL</span>
        <span aria-hidden="true">↓</span>
      </div>
    </section>
  );
}
