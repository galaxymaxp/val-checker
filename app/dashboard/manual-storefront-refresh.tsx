"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type {
  ManualRefreshAvailability,
  RiotConnectionMutationResult,
} from "@/src/types/riot-connection";

interface ManualStorefrontRefreshProps {
  readonly availability: ManualRefreshAvailability;
  readonly connectionId: string;
  readonly nextAvailableAt: string;
  readonly refreshStore: (
    connectionId: string,
  ) => Promise<RiotConnectionMutationResult>;
  readonly unavailableReason?: string | null;
}

function resetLabel(nextAvailableAt: string): string {
  const reset = new Date(nextAvailableAt);
  if (!Number.isFinite(reset.getTime())) {
    return "after the next UTC store reset";
  }

  // This Client Component is also pre-rendered on the server. A fixed locale
  // keeps the reset label stable between Node and the browser at hydration.
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(reset);
}

function unavailableMessage(
  availability: Exclude<ManualRefreshAvailability, "available">,
  nextAvailableAt: string,
): string {
  switch (availability) {
    case "in-progress":
      return "A manual refresh is already in progress for this account.";
    case "succeeded":
      return `Manual refresh used today. Available again ${resetLabel(nextAvailableAt)}.`;
    case "exhausted":
      return `Today’s request reached Riot but did not complete. To prevent a duplicate storefront request, manual refresh returns ${resetLabel(nextAvailableAt)}.`;
    case "unavailable":
      return "Reconnect this Riot account before refreshing its store.";
  }
}

function ManualStorefrontRefreshState({
  availability,
  connectionId,
  nextAvailableAt,
  refreshStore,
  unavailableReason,
}: ManualStorefrontRefreshProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const available = availability === "available";
  const helperId = `manual-refresh-${connectionId}`;

  function refresh() {
    if (!available || isPending) {
      return;
    }

    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await refreshStore(connectionId);
        if (result.ok) {
          setMessage(
            result.warning
              ? `Updated just now. ${result.warning}`
              : "Updated just now.",
          );
        } else {
          setMessage(result.error);
        }
      } catch {
        setMessage("The store could not be refreshed right now.");
      } finally {
        // Refresh both success and failure states: a request that reached Riot
        // is intentionally fenced until the next store day.
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        aria-describedby={helperId}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#08090b] shadow-[0_10px_30px_-16px_rgba(255,255,255,0.55)] enabled:cursor-pointer enabled:hocus:-translate-y-0.5 enabled:hocus:bg-white/85 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-ink-dim"
        disabled={!available || isPending}
        onClick={refresh}
        type="button"
      >
        <span
          aria-hidden="true"
          className={isPending ? "motion-safe:animate-spin" : undefined}
        >
          ↻
        </span>
        {isPending ? "Refreshing…" : "Refresh Store"}
      </button>
      <p className="max-w-md text-xs text-ink-muted" id={helperId}>
        {available
          ? "1 manual refresh available today for this Riot account."
          : unavailableReason ??
            unavailableMessage(availability, nextAvailableAt)}
      </p>
      <p aria-live="polite" className="min-h-5 text-sm text-ink" role="status">
        {isPending ? "Refreshing this account’s storefront…" : message}
      </p>
    </div>
  );
}

/**
 * Query-string navigation can preserve a Client Component instance. Re-keying
 * the stateful control prevents account A's result message appearing for B.
 */
export function ManualStorefrontRefresh(
  props: ManualStorefrontRefreshProps,
) {
  return <ManualStorefrontRefreshState key={props.connectionId} {...props} />;
}
