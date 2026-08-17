import { ManualStorefrontRefresh } from "@/app/dashboard/manual-storefront-refresh";
import type { RiotAccountView } from "@/src/lib/riot/connection-state";
import type { AccountRefreshStatus } from "@/src/lib/storefront/dashboard-status";
import type { RiotConnectionMutationResult } from "@/src/types/riot-connection";

interface StoreStatusPanelProps {
  readonly account: RiotAccountView;
  readonly refreshStatus: AccountRefreshStatus;
  readonly refreshStore: (
    connectionId: string,
  ) => Promise<RiotConnectionMutationResult>;
}

function relativeTime(value: string | null): string {
  if (!value) {
    return "Not yet";
  }
  const timestamp = Date.parse(value);
  const elapsed = Date.now() - timestamp;
  if (!Number.isFinite(timestamp)) {
    return "Unknown";
  }
  if (elapsed < 60_000) {
    return "Just now";
  }
  if (elapsed < 3_600_000) {
    return `${Math.max(1, Math.floor(elapsed / 60_000))}m ago`;
  }
  if (elapsed < 86_400_000) {
    return `${Math.floor(elapsed / 3_600_000)}h ago`;
  }
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function fullTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function healthLabel(status: RiotAccountView["authStatus"]): string {
  switch (status) {
    case "CONNECTED":
      return "Healthy";
    case "REAUTH_REQUIRED":
      return "Reconnect required";
    case "NETWORK_BLOCKED":
      return "Network issue";
    case "RATE_LIMITED":
      return "Rate limited";
    case "RIOT_UNAVAILABLE":
      return "Riot unavailable";
  }
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

export function StoreStatusPanel({
  account,
  refreshStatus,
  refreshStore,
}: StoreStatusPanelProps) {
  const failure = failureLabel(refreshStatus.recentFailureReason);

  return (
    <section
      aria-labelledby="store-status-heading"
      className="grid gap-6 rounded-panel border border-line bg-bg-card p-5 shadow-panel lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:p-6"
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">STORE STATUS</p>
            <h2 id="store-status-heading" className="text-xl!">
              {account.label ?? "Selected Riot account"}
            </h2>
          </div>
          <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-line bg-bg-inset px-3 text-xs text-ink-muted">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                account.authStatus === "CONNECTED"
                  ? "bg-white"
                  : "border border-white/50"
              }`}
            />
            {healthLabel(account.authStatus)}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-card border border-line-soft bg-bg-inset p-3">
            <dt className="text-[11px] tracking-wider text-ink-dim uppercase">
              Automatic attempt
            </dt>
            <dd className="mt-1 text-sm font-semibold">
              {refreshStatus.lastAutomaticAttemptAt ? (
                <time
                  dateTime={refreshStatus.lastAutomaticAttemptAt}
                  title={fullTime(refreshStatus.lastAutomaticAttemptAt)}
                >
                  {relativeTime(refreshStatus.lastAutomaticAttemptAt)}
                </time>
              ) : (
                "Not yet"
              )}
            </dd>
          </div>
          <div className="rounded-card border border-line-soft bg-bg-inset p-3">
            <dt className="text-[11px] tracking-wider text-ink-dim uppercase">
              Automatic success
            </dt>
            <dd className="mt-1 text-sm font-semibold">
              {refreshStatus.lastAutomaticSuccessAt ? (
                <time
                  dateTime={refreshStatus.lastAutomaticSuccessAt}
                  title={fullTime(refreshStatus.lastAutomaticSuccessAt)}
                >
                  {relativeTime(refreshStatus.lastAutomaticSuccessAt)}
                </time>
              ) : (
                "Not yet"
              )}
            </dd>
          </div>
          <div className="rounded-card border border-line-soft bg-bg-inset p-3">
            <dt className="text-[11px] tracking-wider text-ink-dim uppercase">
              Manual success
            </dt>
            <dd className="mt-1 text-sm font-semibold">
              {refreshStatus.lastManualSuccessAt ? (
                <time
                  dateTime={refreshStatus.lastManualSuccessAt}
                  title={fullTime(refreshStatus.lastManualSuccessAt)}
                >
                  {relativeTime(refreshStatus.lastManualSuccessAt)}
                </time>
              ) : (
                "Not used"
              )}
            </dd>
          </div>
          <div className="rounded-card border border-line-soft bg-bg-inset p-3">
            <dt className="text-[11px] tracking-wider text-ink-dim uppercase">
              Next automatic
            </dt>
            <dd className="mt-1 text-sm font-semibold">
              <time
                dateTime={refreshStatus.nextAutomaticAt}
                title={fullTime(refreshStatus.nextAutomaticAt)}
              >
                {fullTime(refreshStatus.nextAutomaticAt)}
              </time>
            </dd>
          </div>
        </dl>
        {failure ? (
          <p className="text-sm text-ink-muted" role="status">
            {failure}
          </p>
        ) : null}
      </div>

      <ManualStorefrontRefresh
        availability={refreshStatus.manualAvailability}
        connectionId={account.id}
        nextAvailableAt={refreshStatus.nextManualAt}
        refreshStore={refreshStore}
        unavailableReason={refreshStatus.manualUnavailableReason}
      />
    </section>
  );
}
