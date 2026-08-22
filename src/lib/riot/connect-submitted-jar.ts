import "server-only";

import type { RiotConnectIdentity } from "@/src/lib/riot/connect-identity";
import {
  RiotConnectionService,
  RiotConsentRequiredError,
} from "@/src/lib/riot/connection-service";
import {
  ManualCookieProvider,
  SubmittedCookieProvider,
} from "@/src/lib/riot/session-provider";
import {
  AesGcmSessionCipher,
  loadSessionKeyring,
} from "@/src/lib/riot/session-crypto";
import { LiveRiotSessionIdentityResolver } from "@/src/lib/riot/session-identity";
import { SupabaseEncryptedSessionStore } from "@/src/lib/riot/session-store";
import { createTlsTunedFetch } from "@/src/lib/riot/tls-fetch";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import type { RiotConnectionMutationResult } from "@/src/types/riot-connection";

export const RIOT_CONNECT_FAILED_MESSAGE =
  "The Riot session could not be connected.";
export const RIOT_CONNECT_CONSENT_MESSAGE =
  "Please confirm consent before connecting.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates and stores a submitted Riot cookie jar for an ALREADY
 * authenticated identity. Shared by the connectRiotSession server action
 * (identity from the Supabase cookie session) and /api/desktop/connect
 * (identity from a one-time capture token), so both paths enforce the same
 * shape and consent checks before any storage dependency is constructed or
 * the jar is read.
 * Error strings are generic on purpose; the jar is never echoed or logged.
 */
export async function connectSubmittedRiotJar(
  identity: RiotConnectIdentity,
  submission: unknown,
): Promise<RiotConnectionMutationResult> {
  if (!isRecord(submission)) {
    return { error: RIOT_CONNECT_FAILED_MESSAGE, ok: false };
  }

  if (submission.consentGranted !== true) {
    return { error: RIOT_CONNECT_CONSENT_MESSAGE, ok: false };
  }

  if (
    typeof submission.serializedJar !== "string" ||
    (submission.region !== undefined && typeof submission.region !== "string") ||
    (submission.label !== undefined && typeof submission.label !== "string") ||
    (submission.connectionId !== undefined &&
      typeof submission.connectionId !== "string")
  ) {
    return { error: RIOT_CONNECT_FAILED_MESSAGE, ok: false };
  }

  let connectAdmin;
  try {
    const admin = createAdminSupabaseClient();
    connectAdmin = admin;
    const store = new SupabaseEncryptedSessionStore(
      admin,
      new AesGcmSessionCipher(loadSessionKeyring()),
    );
    // Resolve the stable Riot identity here too, so a jar connected through
    // the desktop handshake gets the same PUUID and Riot ID as one connected
    // in the browser. Resolution is best effort inside the service, so a
    // rejected /userinfo leaves identity null rather than losing the session.
    const service = new RiotConnectionService(
      new ManualCookieProvider(),
      store,
      new SubmittedCookieProvider(),
      undefined,
      undefined,
      new LiveRiotSessionIdentityResolver(createTlsTunedFetch()),
    );

    await service.connect({
      connectionId: submission.connectionId,
      consentGranted: submission.consentGranted,
      identity,
      label: submission.label,
      region: submission.region,
      session: { serializedJar: submission.serializedJar },
    });
  } catch (error) {
    if (error instanceof RiotConsentRequiredError) {
      return { error: RIOT_CONNECT_CONSENT_MESSAGE, ok: false };
    }

    // Class name only; messages on this path can quote Riot responses.
    console.error("[riot-connect] submitted jar failed", {
      kind: error instanceof Error ? error.name : "Unknown",
    });
    return { error: RIOT_CONNECT_FAILED_MESSAGE, ok: false };
  }

  // Pull a store immediately so a freshly connected account is not empty until
  // the next cron. Never throws; the connection is already saved.
  try {
    const { runConnectStorefrontFetch } = await import(
      "@/src/lib/worker/on-demand-check"
    );
    await runConnectStorefrontFetch(identity.userId, connectAdmin);
  } catch {
    // The store simply stays empty until the next refresh.
  }

  return { ok: true };
}
