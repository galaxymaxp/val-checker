"use server";

import { revalidatePath } from "next/cache";

import {
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
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import type { RiotConnectionMutationResult } from "@/src/types/riot-connection";

const CONNECT_FAILED_MESSAGE = "The Riot session could not be connected.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function connectRiotSession(
  submission: unknown,
): Promise<RiotConnectionMutationResult> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = claims?.sub;

  if (typeof userId !== "string") {
    return { error: "Please sign in again.", ok: false };
  }

  const identity: RiotConnectIdentity = {
    email:
      typeof claims?.email === "string" ? claims.email : undefined,
    userId,
  };
  let allowlist;

  try {
    allowlist = loadRiotConnectAllowlist();
    // Authorization happens before the submitted jar is read or transformed.
    allowlist.assertAllowed(identity);
  } catch {
    return { error: "Riot connection access is not enabled.", ok: false };
  }

  if (!isRecord(submission)) {
    return { error: CONNECT_FAILED_MESSAGE, ok: false };
  }

  if (submission.consentGranted !== true) {
    return {
      error: "Please confirm consent before connecting.",
      ok: false,
    };
  }

  if (
    typeof submission.serializedJar !== "string" ||
    (submission.region !== undefined && typeof submission.region !== "string")
  ) {
    return { error: CONNECT_FAILED_MESSAGE, ok: false };
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
      return {
        error: "Please confirm consent before connecting.",
        ok: false,
      };
    }

    return { error: CONNECT_FAILED_MESSAGE, ok: false };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function disconnectRiotSession(
  connectionId?: unknown,
): Promise<RiotConnectionMutationResult> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;

  if (typeof userId !== "string") {
    return { error: "Please sign in again.", ok: false };
  }

  const admin = createAdminSupabaseClient();
  let deletion = admin.from("riot_connections").delete().eq("user_id", userId);

  // Disconnecting one account must not remove the others on this login.
  if (typeof connectionId === "string" && connectionId.length > 0) {
    deletion = deletion.eq("id", connectionId);
  }

  const { error } = await deletion;

  if (error) {
    return { error: "The Riot session could not be disconnected.", ok: false };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Runs today's check for the signed-in user when the scheduled run has not
 * recorded a storefront yet. The per-connection database claim still admits at
 * most one Riot request per UTC rotation, so this spends that single allowance
 * rather than adding a second one.
 */
export async function checkDailyShopNow(): Promise<RiotConnectionMutationResult> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = claims?.sub;

  if (typeof userId !== "string") {
    return { error: "Please sign in again.", ok: false };
  }

  try {
    const allowlist = loadRiotConnectAllowlist();
    allowlist.assertAllowed({
      email: typeof claims?.email === "string" ? claims.email : undefined,
      userId,
    });
  } catch {
    return { error: "Riot connection access is not enabled.", ok: false };
  }

  try {
    const { runDailyCheckForUser } = await import(
      "@/src/lib/worker/on-demand-check"
    );
    await runDailyCheckForUser(userId);
  } catch {
    return { error: "The shop could not be checked right now.", ok: false };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
