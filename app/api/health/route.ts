import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await createAdminSupabaseClient().rpc("health_check");

    if (error || data !== 1) {
      return Response.json({ status: "unavailable" }, { status: 503 });
    }

    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
