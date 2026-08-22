import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/database";

/**
 * One-time Riot session capture tokens.
 *
 * The token is the bearer credential of the deep-link handshake: the browser
 * mints it while signed into Supabase, a trusted capture client receives it,
 * and that client presents it with the captured jar. Whoever
 * holds the raw value can attach a jar to the minting user, so:
 *
 *   * The raw value is 32 bytes from a CSPRNG and is returned to the caller
 *     exactly once. Only its SHA-256 hash is stored, and nothing here logs
 *     the raw value or the hash.
 *   * Consumption is a single conditional UPDATE, so a token can be claimed
 *     exactly once no matter how many requests race on it.
 *   * Tokens expire after ten minutes so a human can complete MFA or CAPTCHA.
 */
export const CAPTURE_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Base64url of 32 random bytes is 43 characters; anything longer is noise. */
const MAX_RAW_TOKEN_LENGTH = 128;

export class CaptureTokenStorageError extends Error {
  constructor() {
    super("Riot capture token storage operation failed.");
    this.name = "CaptureTokenStorageError";
  }
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Mints a fresh token for the user and returns the RAW value. Any earlier
 * unconsumed token for the same user is deleted first, so at most one live
 * token exists per user at a time.
 */
export async function mintCaptureToken(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  // Opportunistic cleanup, mirroring the pending-auth store: best effort, so
  // a failed purge never blocks the mint.
  try {
    await admin.rpc("purge_expired_desktop_capture_tokens");
  } catch {
    // The conditional consume already refuses expired rows.
  }

  const { error: deleteError } = await admin
    .from("desktop_capture_tokens")
    .delete()
    .eq("user_id", userId)
    .is("consumed_at", null);

  if (deleteError) {
    throw new CaptureTokenStorageError();
  }

  const rawToken = randomBytes(32).toString("base64url");
  const { error } = await admin.from("desktop_capture_tokens").insert({
    expires_at: new Date(Date.now() + CAPTURE_TOKEN_TTL_MS).toISOString(),
    token_hash: hashToken(rawToken),
    user_id: userId,
  });

  if (error) {
    throw new CaptureTokenStorageError();
  }

  return rawToken;
}

/**
 * Atomically claims the token and returns the user it was minted for, or null
 * when the token is unknown, already consumed, or expired.
 *
 * Single use is guaranteed by shape, not by sequencing: this is one
 * conditional UPDATE (`set consumed_at where token_hash matches and
 * consumed_at is null and expires_at is in the future`), never a read
 * followed by a write, so two racing submissions can never both claim it.
 */
export async function consumeCaptureToken(
  admin: SupabaseClient<Database>,
  rawToken: string,
): Promise<string | null> {
  if (
    typeof rawToken !== "string" ||
    rawToken.length === 0 ||
    rawToken.length > MAX_RAW_TOKEN_LENGTH
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("desktop_capture_tokens")
    .update({ consumed_at: now })
    .eq("token_hash", hashToken(rawToken))
    .is("consumed_at", null)
    .gt("expires_at", now)
    .select("user_id")
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data.user_id;
}
