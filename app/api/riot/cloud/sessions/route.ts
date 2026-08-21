import { z } from "zod";

import { resolveCloudConnectIdentity } from "@/src/lib/riot/cloud-connect-auth";
import { buildCloudConnectController } from "@/src/lib/riot/cloud-connect-runtime";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const uuid = z.uuid();
const createSchema = z.object({
  connectionId: uuid.nullish(),
  consentGranted: z.literal(true),
  label: z.string().trim().max(60).nullish(),
  region: z.enum(["ap", "na", "eu", "kr"]).default("ap"),
  viewport: z
    .object({
      height: z.number().int().min(568).max(1200),
      width: z.number().int().min(320).max(1440),
    })
    .default({ height: 844, width: 390 }),
});

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export async function POST(request: Request): Promise<Response> {
  const identity = await resolveCloudConnectIdentity();
  if (!identity) {
    return json({ error: "Please sign in again." }, 401);
  }

  let input: z.infer<typeof createSchema>;
  try {
    input = createSchema.parse(await request.json());
  } catch {
    return json({ error: "The connection request is invalid." }, 400);
  }

  try {
    if (input.connectionId) {
      const { data, error } = await createAdminSupabaseClient()
        .from("riot_connections")
        .select("id")
        .eq("id", input.connectionId)
        .eq("user_id", identity.userId)
        .maybeSingle();
      if (error || !data) {
        return json({ error: "That Riot account is not connected." }, 404);
      }
    }
    const session = await buildCloudConnectController(identity).create({
      connectionId: input.connectionId,
      identity,
      label: input.label,
      region: input.region,
      viewport: input.viewport,
    });
    return json(session, session.state === "failed" ? 503 : 201);
  } catch {
    return json({ error: "Riot connection is temporarily unavailable." }, 503);
  }
}
