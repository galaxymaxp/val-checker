import Link from "next/link";

import type { RiotAccountView } from "@/src/lib/riot/connection-state";

interface RiotAccountSwitcherProps {
  readonly accounts: readonly RiotAccountView[];
  readonly selectedConnectionId: string | null;
}

function accountName(account: RiotAccountView, index: number): string {
  return account.label?.trim() || `Riot account ${index + 1}`;
}

function connectionHealth(account: RiotAccountView): string {
  switch (account.authStatus) {
    case "CONNECTED":
      return "Connected";
    case "REAUTH_REQUIRED":
      return "Reconnect";
    case "RATE_LIMITED":
      return "Rate limited";
    case "NETWORK_BLOCKED":
      return "Network issue";
    case "RIOT_UNAVAILABLE":
      return "Riot unavailable";
  }
}

export function RiotAccountSwitcher({
  accounts,
  selectedConnectionId,
}: RiotAccountSwitcherProps) {
  if (accounts.length === 0) {
    return (
      <section
        aria-labelledby="riot-account-heading"
        className="flex flex-col gap-4 rounded-panel border border-line bg-bg-card p-5 shadow-panel sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="space-y-1">
          <p className="eyebrow">RIOT ACCOUNT</p>
          <h1 id="riot-account-heading">Connect your first account.</h1>
          <p className="text-sm text-ink-muted">
            Each Riot account gets its own daily store, refresh allowance, and
            connection health.
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-bg no-underline"
          href="/dashboard/connection#connect-riot-account"
        >
          Connect Riot account
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="riot-account-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">RIOT ACCOUNT</p>
          <h1 id="riot-account-heading" className="text-2xl!">
            Choose the store you’re viewing.
          </h1>
        </div>
        <Link
          className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm text-ink-muted! no-underline hocus:border-white/50 hocus:bg-white/5 hocus:text-ink!"
          href="/dashboard/connection#connect-riot-account"
        >
          + Connect another account
        </Link>
      </div>
      <nav aria-label="Riot accounts" className="-mx-1 overflow-x-auto px-1 pb-2">
        <ul className="flex min-w-max gap-2" role="list">
          {accounts.map((account, index) => {
            const selected = account.id === selectedConnectionId;
            const name = accountName(account, index);
            const health = connectionHealth(account);
            const connected = account.authStatus === "CONNECTED";

            return (
              <li key={account.id}>
                <Link
                  aria-current={selected ? "page" : undefined}
                  className={`relative flex min-h-16 min-w-48 flex-col justify-center gap-1 rounded-card border px-4 py-2.5 no-underline transition-colors duration-1 ease-out ${
                    selected
                      ? "border-white/35 bg-white/[0.09] text-ink!"
                      : "border-line-soft bg-bg-inset text-ink-muted! hocus:border-line hocus:bg-white/5 hocus:text-ink!"
                  }`}
                  href={`/dashboard?account=${encodeURIComponent(account.id)}`}
                  title={name}
                >
                  {/* The shelf label: marks the current account without
                      relying on the surface tint alone. */}
                  {selected ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-4 top-0 h-px bg-white/70"
                    />
                  ) : null}
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="max-w-40 truncate text-sm font-semibold">
                      {name}
                    </span>
                    {/* Decorative quick-scan cue only; the status is spelled
                        out in text below, so shape never carries meaning. */}
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        connected ? "bg-white" : "border border-white/50"
                      }`}
                    />
                  </span>
                  <span className="block truncate text-[11px] text-ink-dim">
                    {account.region?.toUpperCase() ?? "Region pending"} · {health}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </section>
  );
}
