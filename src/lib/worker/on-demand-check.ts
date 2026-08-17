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
