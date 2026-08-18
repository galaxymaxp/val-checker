"use client";

import { riotAccountDisplayName } from "@/src/lib/riot/account-display";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import type { RiotConnectionMutationResult } from "@/src/types/riot-connection";

type AccountStatus =
  | "CONNECTED"
  | "NETWORK_BLOCKED"
  | "RATE_LIMITED"
  | "REAUTH_REQUIRED"
  | "RIOT_UNAVAILABLE";

export interface ConnectedRiotAccount {
  readonly authStatus: AccountStatus;
  readonly connectedAt: string;
  readonly gameName: string | null;
  readonly id: string;
  readonly label: string | null;
  readonly lastRefreshAt: string | null;
  readonly region: string | null;
  readonly tagLine: string | null;
}

interface ConnectedRiotAccountsProps {
  readonly accounts: readonly ConnectedRiotAccount[];
  readonly disconnect: (
    connectionId: string,
  ) => Promise<RiotConnectionMutationResult>;
}

const REGION_LABELS: Readonly<Record<string, string>> = {
  ap: "Asia Pacific",
  eu: "Europe",
  kr: "Korea",
  na: "North America",
};

function statusLabel(status: AccountStatus): string {
  switch (status) {
    case "CONNECTED":
      return "Connected";
    case "REAUTH_REQUIRED":
      return "Reconnect required";
    case "RATE_LIMITED":
      return "Rate limited";
    case "NETWORK_BLOCKED":
      return "Network issue";
    case "RIOT_UNAVAILABLE":
      return "Riot unavailable";
  }
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function ConnectedRiotAccounts({
  accounts,
  disconnect,
}: ConnectedRiotAccountsProps) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string>();
  const [pendingId, setPendingId] = useState<string>();
  const [error, setError] = useState<string>();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const disconnectTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmingId) {
      confirmButtonRef.current?.focus();
    }
  }, [confirmingId]);

  function beginDisconnect(
    event: MouseEvent<HTMLButtonElement>,
    connectionId: string,
  ) {
    disconnectTriggerRef.current = event.currentTarget;
    setConfirmingId(connectionId);
  }

  function cancelDisconnect() {
    setConfirmingId(undefined);
    disconnectTriggerRef.current?.focus();
  }

  async function disconnectOne(connectionId: string) {
    if (pendingId) {
      return;
    }

    setError(undefined);
    setPendingId(connectionId);
    try {
      const result = await disconnect(connectionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmingId(undefined);
      router.refresh();
    } catch {
      setError("That Riot account could not be disconnected.");
    } finally {
      setPendingId(undefined);
    }
  }

  return (
    <section
      aria-labelledby="connected-riot-accounts-heading"
      className="space-y-5 rounded-panel border border-line bg-bg-card p-5 shadow-panel sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">CONNECTED RIOT ACCOUNTS</p>
          <h2 id="connected-riot-accounts-heading">
            {accounts.length === 0
              ? "No accounts connected"
              : `${accounts.length} account${accounts.length === 1 ? "" : "s"}`}
          </h2>
        </div>
        <a
          className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm text-ink-muted! no-underline hocus:border-white/50 hocus:bg-white/5 hocus:text-ink!"
          href="#connect-riot-account"
        >
          + Connect another Riot account
        </a>
      </div>

      {accounts.length > 0 ? (
        <ul
          className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))]"
          role="list"
        >
          {accounts.map((account, index) => {
            const name = riotAccountDisplayName(account, index);
            const reconnectRequired = account.authStatus === "REAUTH_REQUIRED";
            const pending = pendingId === account.id;

            return (
              <li
                className="flex min-w-0 flex-col gap-4 rounded-card border border-line-soft bg-bg-inset p-4"
                key={account.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate" title={name}>
                      {name}
                    </h3>
                    <p className="text-sm text-ink-muted">
                      {REGION_LABELS[account.region ?? ""] ??
                        account.region?.toUpperCase() ??
                        "Region not set"}
                    </p>
                  </div>
                  <span className="inline-flex min-h-7 shrink-0 items-center gap-2 rounded-full border border-line px-2.5 text-[11px] font-semibold text-ink-muted">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${
                        account.authStatus === "CONNECTED"
                          ? "bg-white"
                          : "border border-white/55"
                      }`}
                    />
                    {statusLabel(account.authStatus)}
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <dt className="text-ink-dim">Connected</dt>
                    <dd className="text-ink-muted">
                      <time dateTime={account.connectedAt}>
                        {dateLabel(account.connectedAt)}
                      </time>
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-ink-dim">Session renewed</dt>
                    <dd className="text-ink-muted">
                      {account.lastRefreshAt ? (
                        <time dateTime={account.lastRefreshAt}>
                          {dateLabel(account.lastRefreshAt)}
                        </time>
                      ) : (
                        "Not yet"
                      )}
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    className="inline-flex min-h-11 items-center rounded-full bg-white px-4 font-semibold text-bg! no-underline"
                    href={`/dashboard?account=${encodeURIComponent(account.id)}`}
                  >
                    View store
                  </Link>
                  {reconnectRequired ? (
                    <Link
                      className="inline-flex min-h-11 items-center rounded-full border border-white/40 px-4 text-ink-muted! no-underline hocus:text-ink!"
                      href={`/dashboard/connection?reconnect=${encodeURIComponent(account.id)}#connect-riot-account`}
                    >
                      Reconnect
                    </Link>
                  ) : null}
                  <button
                    aria-controls={`disconnect-confirmation-${account.id}`}
                    aria-expanded={confirmingId === account.id}
                    className="min-h-11 cursor-pointer rounded-full border border-white/40 bg-transparent px-4 text-ink-muted hocus:bg-white/5 hocus:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={Boolean(pendingId)}
                    onClick={(event) => beginDisconnect(event, account.id)}
                    type="button"
                  >
                    Disconnect
                  </button>
                </div>

                {confirmingId === account.id ? (
                  <div
                    aria-label={`Confirm disconnect ${name}`}
                    aria-live="polite"
                    className="space-y-3 rounded-card border border-white/20 bg-white/5 p-3"
                    id={`disconnect-confirmation-${account.id}`}
                    role="group"
                  >
                    <p className="text-sm">Delete only this stored Riot session?</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="min-h-11 rounded-full border border-white/25 bg-white px-4 text-sm font-semibold text-bg enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
                        disabled={pending}
                        onClick={() => void disconnectOne(account.id)}
                        ref={confirmButtonRef}
                        type="button"
                      >
                        {pending ? "Disconnecting…" : "Confirm disconnect"}
                      </button>
                      <button
                        className="min-h-11 rounded-full border border-white/40 bg-transparent px-4 text-sm text-ink-muted enabled:cursor-pointer disabled:opacity-45"
                        disabled={pending}
                        onClick={cancelDisconnect}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-card border border-dashed border-line p-5 text-sm text-ink-muted">
          Connect a Riot account to check its daily store and watchlist matches.
        </p>
      )}

      {error ? (
        <p className="connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
