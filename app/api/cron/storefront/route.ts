export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MINIMUM_CRON_SECRET_LENGTH = 16;

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (
    !secret ||
    secret.length < MINIMUM_CRON_SECRET_LENGTH ||
    /[\r\n]/.test(secret) ||
    request.headers.get("authorization") !== `Bearer ${secret}`
  ) {
    return json({ status: "unauthorized" }, 401);
  }

  try {
    // Keep construction of admin, encryption, Riot, and Resend dependencies
    // behind the exact cron-secret check.
    const { runConfiguredDailyStorefrontCron } = await import(
      "@/src/lib/worker/storefront-runtime"
    );
    const summary = await runConfiguredDailyStorefrontCron();
    // Keep Vercel logs and the route response aggregate-only. Per-account
    // sanitized results are persisted in riot_run_logs and remain available to
    // internal/manual callers without putting connection ids in platform logs.
    const diagnostic = {
      checked: summary.checked,
      failed: summary.failed,
      notificationFailures: summary.notificationFailures,
      processed: summary.processed,
      refreshed: summary.refreshed,
      skipped: summary.skipped,
      trigger: summary.trigger,
    };
    console.info("[storefront-cron] completed", diagnostic);
    return json({ status: "ok", ...diagnostic }, 200);
  } catch {
    // Never log the caught value: dependency errors can originate near session
    // material. The status and fixed event name are enough to distinguish a
    // top-level construction/enumeration failure from per-account results.
    console.error("[storefront-cron] invocation unavailable");
    return json({ status: "unavailable" }, 503);
  }
}
