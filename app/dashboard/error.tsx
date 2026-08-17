"use client";

import Link from "next/link";

export default function DashboardError({ reset }: { readonly reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-start justify-center gap-4">
      <p className="eyebrow">DASHBOARD UNAVAILABLE</p>
      <h1>Your storefront data could not be loaded.</h1>
      <p className="text-ink-muted">
        Your Riot sessions were not changed. Retry the read, or manage an
        account that needs to be reconnected.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          className="min-h-11 cursor-pointer rounded-full bg-white px-5 text-sm font-semibold text-bg"
          onClick={reset}
          type="button"
        >
          Try again
        </button>
        <Link
          className="inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm text-ink-muted! no-underline hocus:text-ink!"
          href="/dashboard/connection"
        >
          Manage Riot accounts
        </Link>
      </div>
    </main>
  );
}
