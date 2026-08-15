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

export async function disconnectRiotSession(): Promise<RiotConnectionMutationResult> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;

  if (typeof userId !== "string") {
    return { error: "Please sign in again.", ok: false };
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("riot_connections")
    .delete()
    .eq("user_id", userId);

  if (error) {
    return { error: "The Riot session could not be disconnected.", ok: false };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
