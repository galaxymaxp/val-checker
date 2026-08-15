"use client";

import { useEffect, useRef, useState } from "react";

import type { RiotConnectionMutationResult } from "@/src/types/riot-connection";

interface DailyShopRefreshProps {
  /** True when no storefront has been recorded for the current rotation. */
  readonly stale: boolean;
  readonly checkNow: () => Promise<RiotConnectionMutationResult>;
}

export function DailyShopRefresh({ checkNow, stale }: DailyShopRefreshProps) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const attempted = useRef(false);

  async function run() {
    setPending(true);
    setFailed(false);
    const result = await checkNow();
    setPending(false);

    if (!result.ok) {
      setFailed(true);
    }
  }

  useEffect(() => {
    // Fire once per mount when the schedule has not produced today's shop yet.
    // The database claim keeps this to a single Riot request per rotation, so a
    // reload cannot turn into repeated fetching.
    if (!stale || attempted.current) {
      return;
    }

    attempted.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale]);

  if (!stale) {
    return null;
  }

  return (
    <div className="daily-shop-refresh">
      <button
        className="sign-out-button"
        disabled={pending}
        onClick={run}
        type="button"
      >
        {pending ? "Checking…" : "Check now"}
      </button>
      <p aria-live="polite">
        {pending
          ? "Checking your storefront…"
          : failed
            ? "That check did not complete. Today's allowance may already be used."
            : "Today's storefront has not been recorded yet."}
      </p>
    </div>
  );
}
