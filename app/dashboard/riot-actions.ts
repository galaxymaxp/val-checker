"use server";

import { revalidatePath } from "next/cache";

import {
  isRiotAdmin,
  loadRiotConnectAllowlist,
  type RiotConnectIdentity,
} from "@/src/lib/riot/connect-allowlist";
import {
  type CredentialConnectResult,
  RiotConnectionService,
  RiotConsentRequiredError,
  RiotPendingAuthExpiredError,
} from "@/src/lib/riot/connection-service";
import {
  ManualCookieProvider,
  SubmittedCookieProvider,
} from "@/src/lib/riot/session-provider";
import { RiotLoginError, RiotLoginProvider } from "@/src/lib/riot/login-provider";
import { SupabaseEncryptedPendingAuthStore } from "@/src/lib/riot/pending-auth-store";
import {
  AesGcmSessionCipher,
  SessionEncryptionConfigurationError,
  loadSessionKeyring,
} from "@/src/lib/riot/session-crypto";
import { SupabaseEncryptedSessionStore } from "@/src/lib/riot/session-store";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import type {
  RiotConnectionMutationResult,
  RiotCredentialConnectResult,
} from "@/src/types/riot-connection";

const CONNECT_FAILED_MESSAGE = "The Riot session could not be connected.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ResolvedIdentity =
  | { readonly identity: RiotConnectIdentity; readonly ok: true }
  | { readonly error: string; readonly ok: false };

/** Resolves the caller and enforces the fail-closed connect allowlist. */
async function resolveConnectIdentity(): Promise<ResolvedIdentity> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = claims?.sub;

  if (typeof userId !== "string") {
    return { error: "Please sign in again.", ok: false };
  }

  const identity: RiotConnectIdentity = {
    email: typeof claims?.email === "string" ? claims.email : undefined,
    userId,
  };

  try {
    // Authorization happens before any credential or jar is read.
    loadRiotConnectAllowlist().assertAllowed(identity);
  } catch {
    return { error: "Riot connection access is not enabled.", ok: false };
  }

  return { identity, ok: true };
}

function buildCredentialService(allowlist: ReturnType<typeof loadRiotConnectAllowlist>) {
  const admin = createAdminSupabaseClient();
  const cipher = new AesGcmSessionCipher(loadSessionKeyring());

  return new RiotConnectionService(
    new ManualCookieProvider(),
    new SupabaseEncryptedSessionStore(admin, cipher),
    allowlist,
    new SubmittedCookieProvider(),
    new RiotLoginProvider(),
    new SupabaseEncryptedPendingAuthStore(admin, cipher),
  );
}

/** Maps a login failure to user-facing copy. Never echoes Riot's raw error. */
function credentialFailureMessage(error: unknown): string {
  // The keyring is built before any network call, so a missing or malformed
  // SESSION_ENCRYPTION_* value fails with the credential still unsent. Naming
  // it as a connection failure sends the operator off to re-check a password
  // that Riot never saw, so this case reports the real cause.
  if (error instanceof SessionEncryptionConfigurationError) {
    return "Server misconfiguration: the session encryption keyring is missing or invalid. No credential was sent to Riot.";
  }

  if (error instanceof RiotConsentRequiredError) {
    return "Please confirm consent before connecting.";
  }

  if (error instanceof RiotPendingAuthExpiredError) {
    return "That sign-in attempt expired. Please enter your details again.";
  }

  if (error instanceof RiotLoginError) {
    switch (error.failure) {
      case "invalid-credentials":
        return (
          "Riot rejected that sign-in. Use your Riot account username — " +
          "the one you log in with, not your email address and not your " +
          "in-game Riot ID."
        );
      case "session-expired":
        return "That sign-in attempt expired. Please start again.";
      case "invalid-mfa-code":
        return "That verification code was not accepted.";
      case "rate-limited":
        return "Riot is rate limiting sign-in attempts. Please wait and retry.";
      case "malformed-input":
        return "Please enter a Riot username and password.";
      default:
        return "Riot sign-in is unavailable right now. Please try again later.";
    }
  }

  return CONNECT_FAILED_MESSAGE;
}

function toCredentialResult(
  outcome: CredentialConnectResult,
): RiotCredentialConnectResult {
  return outcome.kind === "multifactor"
    ? {
        maskedTarget: outcome.maskedTarget,
        method: outcome.method,
        ok: true,
        status: "multifactor-required",
      }
    : { ok: true, status: "connected" };
}

/**
 * Step one of credential connect. The password is forwarded to the login
 * provider and is never logged, persisted, or returned.
 */
export async function connectRiotCredentials(
  submission: unknown,
): Promise<RiotCredentialConnectResult> {
  const resolved = await resolveConnectIdentity();
  if (!resolved.ok) {
    return { error: resolved.error, ok: false };
  }

  if (
    !isRecord(submission) ||
    typeof submission.username !== "string" ||
    typeof submission.password !== "string" ||
    (submission.region !== undefined && typeof submission.region !== "string") ||
    (submission.label !== undefined && typeof submission.label !== "string")
  ) {
    return { error: CONNECT_FAILED_MESSAGE, ok: false };
  }

  if (submission.consentGranted !== true) {
    return { error: "Please confirm consent before connecting.", ok: false };
  }

  let outcome: CredentialConnectResult;
  try {
    outcome = await buildCredentialService(
      loadRiotConnectAllowlist(),
    ).connectWithCredentials({
      consentGranted: true,
      identity: resolved.identity,
      label: submission.label,
      password: submission.password,
      region: submission.region,
      username: submission.username,
    });
  } catch (error) {
    return { error: credentialFailureMessage(error), ok: false };
  }

  revalidatePath("/dashboard", "layout");
  return toCredentialResult(outcome);
}

/** Step two: completes a challenged sign-in with the emailed or app code. */
export async function submitRiotMfaCode(
  submission: unknown,
): Promise<RiotCredentialConnectResult> {
  const resolved = await resolveConnectIdentity();
  if (!resolved.ok) {
    return { error: resolved.error, ok: false };
  }

  if (!isRecord(submission) || typeof submission.code !== "string") {
    return { error: "Please enter the verification code.", ok: false };
  }

  let outcome: CredentialConnectResult;
  try {
    outcome = await buildCredentialService(
      loadRiotConnectAllowlist(),
    ).submitMfaCode({
      code: submission.code,
      identity: resolved.identity,
    });
  } catch (error) {
    return { error: credentialFailureMessage(error), ok: false };
  }

  revalidatePath("/dashboard", "layout");
  return toCredentialResult(outcome);
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

  // The raw jar paste is an admin-only fallback (roadmap Version 2.4). Ordinary
  // allowlisted users connect through the sign-in form instead.
  if (!isRiotAdmin(identity)) {
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

  revalidatePath("/dashboard", "layout");
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

  revalidatePath("/dashboard", "layout");
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

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
