"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { mintCaptureToken } from "@/src/lib/desktop/capture-token";
import {
  loadRiotConnectAllowlist,
  RiotConnectNotAllowedError,
  type RiotConnectIdentity,
} from "@/src/lib/riot/connect-allowlist";
import { connectSubmittedRiotJar } from "@/src/lib/riot/connect-submitted-jar";
import { canUseRiotCloudConnect } from "@/src/lib/riot/cloud-connect-policy";
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
import { LiveRiotSessionIdentityResolver } from "@/src/lib/riot/session-identity";
import { SupabaseEncryptedSessionStore } from "@/src/lib/riot/session-store";
import { createTlsTunedFetch } from "@/src/lib/riot/tls-fetch";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import type {
  RiotConnectionMutationResult,
  RiotCredentialConnectResult,
  RiotDesktopCaptureTokenResult,
} from "@/src/types/riot-connection";

const CONNECT_FAILED_MESSAGE = "The Riot session could not be connected.";
const databaseUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
);

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
    new LiveRiotSessionIdentityResolver(createTlsTunedFetch()),
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
 * Pulls a store as soon as an account is live so the dashboard is not empty
 * until the next cron. Deliberately awaited: the redirect that follows would
 * otherwise race the fetch and revalidate an empty dashboard. Never throws.
 */
async function fetchStorefrontAfterConnect(userId: string): Promise<void> {
  try {
    const { runConnectStorefrontFetch } = await import(
      "@/src/lib/worker/on-demand-check"
    );
    await runConnectStorefrontFetch(userId);
  } catch {
    // The connection is already saved by this point. A failure to load or run
    // the worker must never turn a successful connect into a reported failure;
    // the store simply stays empty until the next refresh.
  }
}

function refreshWarning(reason: string | null): string | undefined {
  switch (reason) {
    case "CATALOG_FAILED":
      return "Skin details and watchlist matching are temporarily unavailable.";
    case "DELIVERY_FAILED":
      return "Notification delivery did not complete.";
    case "LIFECYCLE_STALE":
    case "UNEXPECTED":
      return "Account health status could not be finalized.";
    default:
      return undefined;
  }
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
    (submission.label !== undefined && typeof submission.label !== "string") ||
    (submission.connectionId !== undefined &&
      !databaseUuidSchema.safeParse(submission.connectionId).success)
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
      connectionId: submission.connectionId,
      identity: resolved.identity,
      label: submission.label,
      password: submission.password,
      region: submission.region,
      username: submission.username,
    });
  } catch (error) {
    return { error: credentialFailureMessage(error), ok: false };
  }

  // Only a completed connect has a session to read a store with; an outstanding
  // multifactor challenge has not produced one yet.
  if (outcome.kind !== "multifactor") {
    await fetchStorefrontAfterConnect(resolved.identity.userId);
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

  // Only a completed connect has a session to read a store with; an outstanding
  // multifactor challenge has not produced one yet.
  if (outcome.kind !== "multifactor") {
    await fetchStorefrontAfterConnect(resolved.identity.userId);
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
    email: typeof claims?.email === "string" ? claims.email : undefined,
    userId,
  };

  // The allowlist, the admin-only gate on the raw jar path, the shape checks,
  // the connect itself and the follow-up storefront fetch all live in the
  // shared helper, so /api/desktop/connect cannot become a way around any of
  // them.
  const result = await connectSubmittedRiotJar(identity, submission, {
    assertAllowed(candidate) {
      if (
        loadRiotConnectAllowlist().allows(candidate) ||
        canUseRiotCloudConnect(candidate)
      ) {
        return;
      }
      throw new RiotConnectNotAllowedError();
    },
  });
  if (!result.ok) {
    return result;
  }

  revalidatePath("/dashboard", "layout");
  return result;
}

/**
 * Mints the one-time token that starts the desktop deep-link handshake
 * (valchecker://capture?token=...). The token proves which signed-in user a
 * captured jar belongs to, so it is minted behind the exact gate that guards
 * the jar submission itself: the connect allowlist. The raw token is returned
 * once and only its hash is stored; it is never logged.
 */
export async function createDesktopCaptureToken(): Promise<RiotDesktopCaptureTokenResult> {
  const resolved = await resolveConnectIdentity();
  if (!resolved.ok) {
    return { error: resolved.error, ok: false };
  }

  try {
    loadRiotConnectAllowlist().assertAllowed(resolved.identity);
  } catch {
    return { error: "Riot connection access is not enabled.", ok: false };
  }

  try {
    const token = await mintCaptureToken(
      createAdminSupabaseClient(),
      resolved.identity.userId,
    );
    return { ok: true, token };
  } catch {
    return { error: "The capture link could not be created.", ok: false };
  }
}

export async function disconnectRiotSession(
  connectionId: unknown,
): Promise<RiotConnectionMutationResult> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;

  if (typeof userId !== "string") {
    return { error: "Please sign in again.", ok: false };
  }

  const parsedConnectionId = databaseUuidSchema.safeParse(connectionId);
  if (!parsedConnectionId.success) {
    return { error: "Choose a valid Riot account to disconnect.", ok: false };
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("riot_connections")
    .delete()
    .eq("user_id", userId)
    .eq("id", parsedConnectionId.data);

  if (error) {
    return { error: "The Riot session could not be disconnected.", ok: false };
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Runs the separate once-per-store-day manual allowance for one owned account. */
export async function refreshRiotStorefront(
  connectionId: unknown,
): Promise<RiotConnectionMutationResult> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = claims?.sub;

  if (typeof userId !== "string") {
    return { error: "Please sign in again.", ok: false };
  }

  const parsedConnectionId = databaseUuidSchema.safeParse(connectionId);
  if (!parsedConnectionId.success) {
    return { error: "Choose a valid Riot account to refresh.", ok: false };
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

  let warning: string | undefined;
  try {
    // Verify ownership before building the worker or making any Riot request.
    const admin = createAdminSupabaseClient();
    const { data: ownedConnection, error: ownershipError } = await admin
      .from("riot_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("id", parsedConnectionId.data)
      .maybeSingle();
    if (ownershipError || !ownedConnection) {
      return { error: "That Riot account is not connected.", ok: false };
    }

    const { runDailyCheckForUser } = await import(
      "@/src/lib/worker/on-demand-check"
    );
    const { summary } = await runDailyCheckForUser(
      userId,
      parsedConnectionId.data,
    );
    const account = summary?.accounts.find(
      (result) => result.connectionId === parsedConnectionId.data,
    );

    if (!account || account.outcome !== "checked") {
      if (account?.reason === "MANUAL_CLAIM_HELD") {
        return {
          error: "This account’s manual refresh is already used or in progress today.",
          ok: false,
        };
      }
      if (account?.reason === "SESSION_LEASE_HELD") {
        return {
          error:
            "This Riot account is already refreshing, or a previous request has an uncertain outcome. Refresh the dashboard to see when manual refresh is available.",
          ok: false,
        };
      }
      if (account?.reason === "ACCOUNT_UNAVAILABLE") {
        return {
          error:
            "This Riot account is not ready for manual refresh. Reconnect it or wait for its identity to be verified.",
          ok: false,
        };
      }
      if (account?.classification === "DEAD") {
        return {
          error: "Reconnect this Riot account before refreshing its store.",
          ok: false,
        };
      }
      return { error: "The shop could not be refreshed right now.", ok: false };
    }
    warning = refreshWarning(account.reason);
  } catch {
    return { error: "The shop could not be refreshed right now.", ok: false };
  }

  revalidatePath("/dashboard", "layout");
  return warning ? { ok: true, warning } : { ok: true };
}

/** Backward-compatible alias; callers must still provide an exact account. */
export async function checkDailyShopNow(
  connectionId: unknown,
): Promise<RiotConnectionMutationResult> {
  return refreshRiotStorefront(connectionId);
}
