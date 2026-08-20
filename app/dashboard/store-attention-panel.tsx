import Link from "next/link";

import { ManualStorefrontRefresh } from "@/app/dashboard/manual-storefront-refresh";
import type { RiotAccountView } from "@/src/lib/riot/connection-state";
import type { DailyShopView } from "@/src/lib/storefront/daily-shop";
import type { AccountRefreshStatus } from "@/src/lib/storefront/dashboard-status";
import type { RiotConnectionMutationResult } from "@/src/types/riot-connection";

interface StoreAttentionPanelProps {
  readonly account: RiotAccountView;
  readonly refreshStatus: AccountRefreshStatus;
  readonly refreshStore: (
    connectionId: string,
  ) => Promise<RiotConnectionMutationResult>;
  readonly shop: DailyShopView | null;
  readonly storeDate: string;
}

function failureLabel(reason: string | null): string | null {
  switch (reason) {
    case "REAUTH_FAILED":
    case "SESSION_UNAVAILABLE":
      return "The stored Riot session needs attention.";
    case "STOREFRONT_FAILED":
      return "Riot did not return a valid storefront.";
    case "CATALOG_FAILED":
      return "The store was updated, but skin details and watchlist matching are temporarily unavailable.";
    case "DELIVERY_FAILED":
      return "The store was checked, but a downstream notification step failed.";
    case "ATTEMPT_FENCED":
      return "Another refresh already held this account’s request fence.";
    case "LIFECYCLE_STALE":
      return "The store was updated, but account health status could not be finalized.";
    case "SESSION_LEASE_HELD":
      return "Another refresh was already in progress for this Riot account.";
    case "UNEXPECTED":
      return "The latest automatic check did not complete.";
    default:
      return null;
  }
}

function connectionLabel(status: RiotAccountView["authStatus"]): string | null {
  switch (status) {
    case "CONNECTED":
      return null;
    case "REAUTH_REQUIRED":
      return "This Riot account needs to be reconnected before its store can be checked.";
    case "NETWORK_BLOCKED":
      return "Riot could not be reached from this account’s last check.";
    case "RATE_LIMITED":
      return "Riot rate-limited this account’s last check.";
    case "RIOT_UNAVAILABLE":
      return "Riot was unavailable during this account’s last check.";
  }
}

/**
 * Renders nothing while today's store is present and healthy. The refresh
 * control is an exception path, not a standing dashboard fixture: it appears
 * only when the store is missing for the current rotation or the last check
 * reported a problem.
 */
export function StoreAttentionPanel({
  account,
  refreshStatus,
  refreshStore,
  shop,
  storeDate,
}: StoreAttentionPanelProps) {
  const missingToday = !shop || shop.rotationDate !== storeDate;
  const connection = connectionLabel(account.authStatus);
  const failure = failureLabel(refreshStatus.recentFailureReason);
  const reason =
    connection ??
    failure ??
    (missingToday ? "Today’s store has not been checked yet." : null);

  if (!reason) {
    return null;
  }

  return (
    <section
      aria-labelledby="store-attention-heading"
      className="flex flex-col gap-4 rounded-panel border border-line bg-bg-card p-4 shadow-panel sm:flex-row sm:items-center sm:justify-between sm:p-5"
    >
      <div className="space-y-1">
        <h2 className="text-sm! font-semibold" id="store-attention-heading">
          {missingToday ? "Store not checked yet" : "Last check needs attention"}
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">{reason}</p>
      </div>
      {account.authStatus === "CONNECTED" ? (
        <ManualStorefrontRefresh
          availability={refreshStatus.manualAvailability}
          connectionId={account.id}
          nextAvailableAt={refreshStatus.nextManualAt}
          refreshStore={refreshStore}
          unavailableReason={refreshStatus.manualUnavailableReason}
        />
      ) : (
        <Link
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-[#08090b]! no-underline hocus:-translate-y-0.5 hocus:bg-white/85"
          href={`/dashboard/connection?reconnect=${account.id}`}
        >
          Reconnect
        </Link>
      )}
    </section>
  );
}
