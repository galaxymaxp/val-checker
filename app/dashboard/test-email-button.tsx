"use client";

import { useState } from "react";

import type { RiotConnectionMutationResult } from "@/src/types/riot-connection";

interface TestEmailButtonProps {
  readonly sendTestEmail: () => Promise<RiotConnectionMutationResult>;
}

/**
 * Sends one sample watchlist email, built from a random offer in the latest
 * stored store and rendered with the real template. Writes nothing and spends
 * no allowance, so it can be repeated to check delivery and formatting.
 */
export function TestEmailButton({ sendTestEmail }: TestEmailButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [failed, setFailed] = useState(false);

  async function send() {
    setIsPending(true);
    setMessage(undefined);

    const result = await sendTestEmail();
    setFailed(!result.ok);
    setMessage(
      result.ok
        ? (result.warning ?? "Sample email sent.")
        : result.error,
    );
    setIsPending(false);
  }

  return (
    <section
      aria-labelledby="test-email-heading"
      className="flex flex-col gap-3 rounded-panel border border-line bg-bg-card p-5 shadow-panel"
    >
      <div>
        <p className="eyebrow">NOTIFICATIONS</p>
        <h2 className="text-lg!" id="test-email-heading">
          Preview a watchlist email
        </h2>
      </div>
      <p className="max-w-prose text-sm text-ink-muted">
        Sends one sample to your account address, using a random offer from
        today&apos;s store and the same template a real match uses. It does not
        create a notification or use your daily refresh.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-ink! enabled:cursor-pointer enabled:hocus:border-white/50 enabled:hocus:bg-white/5 disabled:cursor-not-allowed disabled:text-ink-dim!"
          disabled={isPending}
          onClick={() => {
            void send();
          }}
          type="button"
        >
          {isPending ? "Sending…" : "Send test email"}
        </button>
      </div>
      <p
        aria-live="polite"
        className={`min-h-5 text-sm ${failed ? "text-ink" : "text-ink-muted"}`}
        role="status"
      >
        {message}
      </p>
    </section>
  );
}
