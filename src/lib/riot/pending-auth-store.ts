import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { RiotRegion } from "@/src/lib/riot/account-config";
import {
  AesGcmSessionCipher,
  type EncryptedSessionValue,
} from "@/src/lib/riot/session-crypto";
import type { Database } from "@/src/types/database";

/**
 * Holds the pending-authentication cookie between the credential step and the
 * MFA code step (roadmap Version 2.4).
 *
 * Encrypted with the same keyring and `user_id` AAD as a real session, because
 * although a pending cookie cannot reach an account on its own, it is still
 * session material. It expires quickly and is deleted the moment it is spent.
 *
 * No password reaches this module.
 */

export const PENDING_AUTH_TTL_MS = 10 * 60 * 1_000;

export class PendingAuthStorageError extends Error {
  constructor() {
    super("Pending Riot authentication storage operation failed.");
    this.name = "PendingAuthStorageError";
  }
}

export interface PendingAuthRecord {
  readonly connectionId?: string | null;
  readonly label: string | null;
  readonly pendingJar: Uint8Array;
  readonly region: RiotRegion | null;
}

export interface PendingAuthSaveOptions {
  readonly connectionId?: string | null;
  readonly label?: string | null;
  readonly region?: RiotRegion | null;
}

function encodeBytea(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function decodeBytea(value: string): Uint8Array {
  if (!/^\\x(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new PendingAuthStorageError();
  }

  return new Uint8Array(Buffer.from(value.slice(2), "hex"));
}

function storedValue(row: {
  encrypted_jar: string;
  jar_nonce: string;
  session_key_version: number;
}): EncryptedSessionValue {
  return {
    ciphertext: decodeBytea(row.encrypted_jar),
    keyVersion: row.session_key_version,
    nonce: decodeBytea(row.jar_nonce),
  };
}

export interface PendingAuthStore {
  /** Replaces any challenge already in flight for this login. */
  save(
    userId: string,
    pendingJar: Uint8Array,
    options?: PendingAuthSaveOptions,
  ): Promise<void>;
  /** Returns the unexpired record, or null. Does not consume it. */
  load(userId: string): Promise<PendingAuthRecord | null>;
  clear(userId: string): Promise<void>;
}

export class SupabaseEncryptedPendingAuthStore implements PendingAuthStore {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly cipher: AesGcmSessionCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async save(
    userId: string,
    pendingJar: Uint8Array,
    options: PendingAuthSaveOptions = {},
  ): Promise<void> {
    if (!(pendingJar instanceof Uint8Array) || pendingJar.byteLength === 0) {
      throw new PendingAuthStorageError();
    }

    // Opportunistic sweep keeps abandoned challenges from lingering without
    // needing a scheduled job. A failure here must not fail the connect.
    await this.purgeExpired();

    const encrypted = this.cipher.encrypt(userId, pendingJar);
    const expiresAt = new Date(this.now().getTime() + PENDING_AUTH_TTL_MS);

    const { error } = await this.supabase
      .from("riot_pending_auth")
      .upsert(
        {
          encrypted_jar: encodeBytea(encrypted.ciphertext),
          connection_id: options.connectionId ?? null,
          expires_at: expiresAt.toISOString(),
          jar_nonce: encodeBytea(encrypted.nonce),
          label: options.label ?? null,
          region: options.region ?? null,
          session_key_version: encrypted.keyVersion,
          user_id: userId,
        },
        { onConflict: "user_id" },
      );

    if (error) {
      throw new PendingAuthStorageError();
    }
  }

  async load(userId: string): Promise<PendingAuthRecord | null> {
    const { data, error } = await this.supabase
      .from("riot_pending_auth")
      .select(
        "encrypted_jar, jar_nonce, session_key_version, connection_id, region, label, expires_at",
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new PendingAuthStorageError();
    }

    if (!data) {
      return null;
    }

    // Expiry is enforced here as well as by the sweep, so a row that outlives
    // its window can never be spent.
    if (Date.parse(data.expires_at) <= this.now().getTime()) {
      await this.clear(userId);
      return null;
    }

    return {
      connectionId: data.connection_id,
      label: data.label,
      pendingJar: this.cipher.decrypt(userId, storedValue(data)),
      region: (data.region as RiotRegion | null) ?? null,
    };
  }

  async clear(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from("riot_pending_auth")
      .delete()
      .eq("user_id", userId);

    if (error) {
      throw new PendingAuthStorageError();
    }
  }

  private async purgeExpired(): Promise<void> {
    try {
      await this.supabase.rpc("purge_expired_riot_pending_auth");
    } catch {
      // Best-effort cleanup; load() still enforces expiry per row.
    }
  }
}
