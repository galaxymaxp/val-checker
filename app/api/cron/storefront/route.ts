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
    return json({ status: "ok", ...summary }, 200);
  } catch {
    return json({ status: "unavailable" }, 503);
  }
}
