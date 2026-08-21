import { z } from "zod";

import { resolveCloudConnectIdentity } from "@/src/lib/riot/cloud-connect-auth";
import { buildCloudConnectController } from "@/src/lib/riot/cloud-connect-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idSchema = z.uuid();

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

async function context(params: Promise<{ id: string }>) {
  const identity = await resolveCloudConnectIdentity();
  const id = idSchema.safeParse((await params).id);
  return { id, identity };
}

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ id: string }> },
): Promise<Response> {
  const resolved = await context(params);
  if (!resolved.identity) {
    return json({ error: "Please sign in again." }, 401);
  }
  if (!resolved.id.success) {
    return json({ error: "Connection session not found." }, 404);
  }
  try {
    const session = await buildCloudConnectController(resolved.identity).status(
      resolved.id.data,
      resolved.identity,
    );
    return session
      ? json(session, 200)
      : json({ error: "Connection session not found." }, 404);
  } catch {
    return json({ error: "Riot connection is temporarily unavailable." }, 503);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { readonly params: Promise<{ id: string }> },
): Promise<Response> {
  const resolved = await context(params);
  if (!resolved.identity) {
    return json({ error: "Please sign in again." }, 401);
  }
  if (!resolved.id.success) {
    return json({ error: "Connection session not found." }, 404);
  }
  try {
    const session = await buildCloudConnectController(resolved.identity).cancel(
      resolved.id.data,
      resolved.identity,
    );
    return session
      ? json(session, 200)
      : json({ error: "Connection session not found." }, 404);
  } catch {
    return json({ error: "Riot connection is temporarily unavailable." }, 503);
  }
}
