import { revalidatePath } from "next/cache";
import { z } from "zod";

import { consumeCaptureToken } from "@/src/lib/desktop/capture-token";
import type { RiotConnectIdentity } from "@/src/lib/riot/connect-allowlist";
import {
  connectSubmittedRiotJar,
  RIOT_CONNECT_NOT_ENABLED_MESSAGE,
} from "@/src/lib/riot/connect-submitted-jar";
import { MAX_SUBMITTED_COOKIE_JAR_BYTES } from "@/src/lib/riot/session-provider";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Destination of the trusted capture handshake. The browser extension (and
 * the legacy Electron client during migration) captures the Riot cookie jar
 * and POSTs { token, jar } here.
 *
 * There is no Supabase cookie session on this request — the capture client is
 * not signed into Supabase — so the one-time capture token is the entire authentication:
 * it resolves to the user it was minted for, exactly once, within its TTL.
 * The resolved user then passes through the very same allowlist and admin
 * gates as the browser's connectRiotSession action, so the deep link can
 * never connect a jar for a user who could not have done it in the browser.
 *
 * Nothing here logs or echoes the token, the jar, or any cookie value.
 */

// The body is the jar plus a short token and JSON framing. Anything past the
// jar ceiling plus this envelope is rejected before parsing.
const MAX_BODY_BYTES = MAX_SUBMITTED_COOKIE_JAR_BYTES + 1024;

const submissionSchema = z.object({
  connectionId: z.string().uuid().optional(),
  jar: z.string().min(1),
  label: z.string().max(60).optional(),
  region: z.enum(["ap", "na", "eu", "kr"]).optional(),
  token: z.string().min(1).max(128),
});

const UNAUTHORIZED_MESSAGE = "This capture link is invalid or has expired.";
const FAILED_MESSAGE = "The Riot session could not be connected.";

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: string;
  try {
    body = await request.text();
  } catch {
    return json({ error: FAILED_MESSAGE, ok: false }, 400);
  }

  // Size gate first: an oversized jar is refused before any parse or any
  // database read, and before the token is spent.
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    return json({ error: FAILED_MESSAGE, ok: false }, 413);
  }

  let submission: z.infer<typeof submissionSchema>;
  try {
    const parsed = submissionSchema.safeParse(JSON.parse(body));
    if (!parsed.success) {
      return json({ error: FAILED_MESSAGE, ok: false }, 400);
    }
    submission = parsed.data;
  } catch {
    return json({ error: FAILED_MESSAGE, ok: false }, 400);
  }

  if (Buffer.byteLength(submission.jar, "utf8") > MAX_SUBMITTED_COOKIE_JAR_BYTES) {
    return json({ error: FAILED_MESSAGE, ok: false }, 413);
  }

  try {
    const admin = createAdminSupabaseClient();

    // Atomic single-use claim; expired, consumed, and unknown tokens all
    // resolve to null and are indistinguishable to the caller.
    const userId = await consumeCaptureToken(admin, submission.token);
    if (userId === null) {
      return json({ error: UNAUTHORIZED_MESSAGE, ok: false }, 401);
    }

    // The token proves which user minted it, but the allowlist and admin
    // gates are email-aware, so resolve the account before gating.
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user) {
      return json({ error: UNAUTHORIZED_MESSAGE, ok: false }, 401);
    }

    const identity: RiotConnectIdentity = {
      email: typeof data.user.email === "string" ? data.user.email : undefined,
      userId,
    };

    // Consent was granted in the browser when the operator started the
    // handshake; the deep link only exists because that button was pressed.
    const result = await connectSubmittedRiotJar(identity, {
      connectionId: submission.connectionId,
      consentGranted: true,
      label: submission.label,
      region: submission.region,
      serializedJar: submission.jar,
    });

    if (!result.ok) {
      const status =
        result.error === RIOT_CONNECT_NOT_ENABLED_MESSAGE ? 403 : 400;
      return json(result, status);
    }

    revalidatePath("/dashboard", "layout");
    return json({ ok: true }, 200);
  } catch {
    return json({ error: FAILED_MESSAGE, ok: false }, 503);
  }
}
