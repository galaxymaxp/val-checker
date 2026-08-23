import "server-only";

import {
  isRiotAdmin,
  loadRiotConnectAllowlist,
  type RiotConnectIdentity,
} from "@/src/lib/riot/connect-allowlist";
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
import { SupabaseEncryptedSessionStore } from "@/src/lib/riot/session-store";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import type { RiotConnectionMutationResult } from "@/src/types/riot-connection";

export const RIOT_CONNECT_NOT_ENABLED_MESSAGE =
  "Riot connection access is not enabled.";
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
 * gates in the same order:
 *
 *   1. connect allowlist (fail closed),
 *   2. the admin-only gate on the raw jar path (roadmap Version 2.4),
 *   3. shape and consent checks,
 *
 * all before any storage dependency is constructed or the jar is read.
 * Error strings are generic on purpose; the jar is never echoed or logged.
 */
export async function connectSubmittedRiotJar(
  identity: RiotConnectIdentity,
  submission: unknown,
): Promise<RiotConnectionMutationResult> {
  let allowlist;

  try {
    allowlist = loadRiotConnectAllowlist();
    // Authorization happens before the submitted jar is read or transformed.
    allowlist.assertAllowed(identity);
  } catch {
    return { error: RIOT_CONNECT_NOT_ENABLED_MESSAGE, ok: false };
  }

  // The raw jar is an admin-only path (roadmap Version 2.4). Ordinary
  // allowlisted users connect through the sign-in form instead.
  if (!isRiotAdmin(identity)) {
    return { error: RIOT_CONNECT_NOT_ENABLED_MESSAGE, ok: false };
  }

  if (!isRecord(submission)) {
    return { error: RIOT_CONNECT_FAILED_MESSAGE, ok: false };
  }

  if (submission.consentGranted !== true) {
    return { error: RIOT_CONNECT_CONSENT_MESSAGE, ok: false };
  }

  if (
    typeof submission.serializedJar !== "string" ||
    (submission.region !== undefined && typeof submission.region !== "string")
  ) {
    return { error: RIOT_CONNECT_FAILED_MESSAGE, ok: false };
  }

  try {
    const admin = createAdminSupabaseClient();
    const store = new SupabaseEncryptedSessionStore(
      admin,
      new AesGcmSessionCipher(loadSessionKeyring()),
    );
    const service = new RiotConnectionService(
      new ManualCookieProvider(),
      store,
      allowlist,
      new SubmittedCookieProvider(),
    );

    await service.connect({
      consentGranted: submission.consentGranted,
      identity,
      region: submission.region,
      session: { serializedJar: submission.serializedJar },
    });
  } catch (error) {
    if (error instanceof RiotConsentRequiredError) {
      return { error: RIOT_CONNECT_CONSENT_MESSAGE, ok: false };
    }

    return { error: RIOT_CONNECT_FAILED_MESSAGE, ok: false };
  }

  return { ok: true };
}
