import "server-only";

import type { DailyStorefrontSummary } from "@/src/lib/worker/storefront-worker";

export type OnDemandCheckOutcome = {
  readonly ran: boolean;
  readonly summary: DailyStorefrontSummary | null;
};

export class ManualStorefrontTargetError extends Error {
  constructor() {
    super("A specific Riot connection is required for a manual refresh.");
    this.name = "ManualStorefrontTargetError";
  }
}

const DATABASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs the manual allowance for one exact connection owned by the signed-in
 * user. Ownership is checked again by both connection enumeration and the
 * database claim, so a caller-supplied connection id cannot cross accounts.
 *
 * The manual database claim is independent from the automatic daily claim. A
 * pre-request failure is released for retry. Once the fenced Riot request
 * starts, that attempt is retained; record_storefront_refresh atomically marks
 * success only after a valid catalog-independent shop is durable.
 */
export async function runDailyCheckForUser(
  userId: string,
  connectionId?: string,
): Promise<OnDemandCheckOutcome> {
  if (
    !DATABASE_UUID_PATTERN.test(userId) ||
    !connectionId ||
    !DATABASE_UUID_PATTERN.test(connectionId)
  ) {
    throw new ManualStorefrontTargetError();
  }

  const { buildConfiguredDailyStorefrontWorker } = await import(
    "@/src/lib/worker/storefront-runtime"
  );

  const worker = await buildConfiguredDailyStorefrontWorker({
    connectionId,
    trigger: "manual",
    userId,
  });
  const summary = await worker.run();

  return { ran: summary.refreshed > 0, summary };
}

/**
 * Fetches a store immediately after an account is connected or reconnected, so
 * a new account shows offers straight away instead of waiting for the next
 * 00:05 UTC cron.
 *
 * Runs as `operator`, which shares the automatic daily claim. A freshly
 * connected account has not spent that claim, so this fetches; cron later finds
 * it taken and correctly skips. The separate manual allowance is never touched,
 * so connecting does not cost the user their manual refresh.
 *
 * Scoped to the signed-in user and never throws: connecting has already
 * succeeded by this point, and a storefront failure must not undo it.
 */
export async function runConnectStorefrontFetch(
  userId: string,
): Promise<OnDemandCheckOutcome> {
  if (!DATABASE_UUID_PATTERN.test(userId)) {
    return { ran: false, summary: null };
  }

  try {
    const { buildConfiguredDailyStorefrontWorker } = await import(
      "@/src/lib/worker/storefront-runtime"
    );
    const worker = await buildConfiguredDailyStorefrontWorker({
      trigger: "operator",
      userId,
    });
    const summary = await worker.run();
    return { ran: summary.refreshed > 0, summary };
  } catch {
    return { ran: false, summary: null };
  }
}
