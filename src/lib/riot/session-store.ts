import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CapturedSession } from "@/src/lib/riot/session-provider";
import type { RiotRegion } from "@/src/lib/riot/account-config";
import {
  AesGcmSessionCipher,
  type EncryptedSessionValue,
} from "@/src/lib/riot/session-crypto";
import type { Database } from "@/src/types/database";

export class SessionStorageError extends Error {
  constructor() {
    super("Encrypted session storage operation failed.");
    this.name = "SessionStorageError";
  }
}

export interface SessionSaveOptions {
  readonly connectionId?: string | null;
  readonly label?: string | null;
  readonly puuid?: string | null;
  readonly region: RiotRegion;
}

/**
 * Rows are addressed per connection so one login can hold several Riot
 * accounts. The encryption AAD stays bound to user_id, which keeps ciphertext
 * from being replayed across owners.
 */
export interface SessionStore {
  delete(userId: string, connectionId: string): Promise<void>;
  load(
    userId: string,
    connectionId: string,
    expectedConnectionEpoch?: string,
  ): Promise<Uint8Array | null>;
  persistRotated(
    userId: string,
    connectionId: string,
    session: CapturedSession,
    expectedConnectionEpoch: string,
    rotationLeaseToken: string,
  ): Promise<void>;
  save(
    userId: string,
    session: CapturedSession,
    account?: SessionSaveOptions,
  ): Promise<string>;
}

function encodeBytea(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function decodeBytea(value: string): Uint8Array {
  if (!/^\\x(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new SessionStorageError();
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

export class SupabaseEncryptedSessionStore implements SessionStore {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly cipher: AesGcmSessionCipher,
  ) {}

  async persistRotated(
    userId: string,
    connectionId: string,
    session: CapturedSession,
    expectedConnectionEpoch: string,
    rotationLeaseToken: string,
  ): Promise<void> {
    if (
      session.kind !== "captured-session" ||
      !(session.material instanceof Uint8Array) ||
      session.material.byteLength === 0
    ) {
      throw new SessionStorageError();
    }

    const encrypted = this.cipher.encrypt(userId, session.material);
    let query = this.supabase
      .from("riot_connections")
      .update({
        encrypted_jar: encodeBytea(encrypted.ciphertext),
        jar_nonce: encodeBytea(encrypted.nonce),
        last_refresh_at: session.capturedAt,
        session_key_version: encrypted.keyVersion,
      })
      .eq("user_id", userId)
      .eq("id", connectionId);
    query = query.eq("connection_epoch", expectedConnectionEpoch);
    query = query
      .eq("rotation_lease_token", rotationLeaseToken)
      .is("rotation_lease_storefront_attempted_at", null);
    const { data, error } = await query.select("id").maybeSingle();

    if (error || !data) {
      throw new SessionStorageError();
    }
  }

  async save(
    userId: string,
    session: CapturedSession,
    account?: SessionSaveOptions,
  ): Promise<string> {
    if (
      session.kind !== "captured-session" ||
      !(session.material instanceof Uint8Array) ||
      session.material.byteLength === 0
    ) {
      throw new SessionStorageError();
    }

    const encrypted = this.cipher.encrypt(userId, session.material);
    const storedSession = {
      auth_status: "CONNECTED" as const,
      connection_epoch: randomUUID(),
      consecutive_failures: 0,
      encrypted_jar: encodeBytea(encrypted.ciphertext),
      jar_nonce: encodeBytea(encrypted.nonce),
      label: account?.label ?? null,
      last_refresh_at: session.capturedAt,
      rotation_lease_claimed_at: null,
      rotation_lease_store_date: null,
      rotation_lease_storefront_attempted_at: null,
      rotation_lease_token: null,
      ...(account?.puuid ? { puuid: account.puuid } : {}),
      ...(account ? { region: account.region } : {}),
      session_key_version: encrypted.keyVersion,
    };

    if (account?.connectionId) {
      let query = this.supabase
        .from("riot_connections")
        .update(storedSession)
        .eq("user_id", userId)
        .eq("id", account.connectionId);
      // Reconnect may hydrate a legacy null identity, but it may not silently
      // replace an existing row with a different Riot account.
      if (account.puuid) {
        query = query.or(`puuid.is.null,puuid.eq.${account.puuid}`);
      }
      const { data, error } = await query.select("id").maybeSingle();
      if (error || !data) {
        throw new SessionStorageError();
      }
      return data.id;
    }

    const { data, error } = await this.supabase
      .from("riot_connections")
      .insert({
        ...storedSession,
        user_id: userId,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new SessionStorageError();
    }

    return data.id;
  }

  async load(
    userId: string,
    connectionId: string,
    expectedConnectionEpoch?: string,
  ): Promise<Uint8Array | null> {
    let query = this.supabase
      .from("riot_connections")
      .select("encrypted_jar, jar_nonce, session_key_version")
      .eq("user_id", userId)
      .eq("id", connectionId);
    if (expectedConnectionEpoch) {
      query = query.eq("connection_epoch", expectedConnectionEpoch);
    }
    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new SessionStorageError();
    }

    if (!data) {
      return null;
    }

    return this.cipher.decrypt(userId, storedValue(data));
  }

  async delete(userId: string, connectionId: string): Promise<void> {
    const { error } = await this.supabase
      .from("riot_connections")
      .delete()
      .eq("user_id", userId)
      .eq("id", connectionId);

    if (error) {
      throw new SessionStorageError();
    }
  }
}
