import "server-only";

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

export interface SessionStore {
  delete(userId: string): Promise<void>;
  load(userId: string): Promise<Uint8Array | null>;
  save(
    userId: string,
    session: CapturedSession,
    account?: { readonly region: RiotRegion },
  ): Promise<void>;
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

  async save(
    userId: string,
    session: CapturedSession,
    account?: { readonly region: RiotRegion },
  ): Promise<void> {
    if (
      session.kind !== "captured-session" ||
      !(session.material instanceof Uint8Array) ||
      session.material.byteLength === 0
    ) {
      throw new SessionStorageError();
    }

    const encrypted = this.cipher.encrypt(userId, session.material);
    const { error } = await this.supabase.from("riot_connections").upsert(
      {
        auth_status: "CONNECTED",
        consecutive_failures: 0,
        encrypted_jar: encodeBytea(encrypted.ciphertext),
        jar_nonce: encodeBytea(encrypted.nonce),
        last_refresh_at: session.capturedAt,
        ...(account ? { region: account.region } : {}),
        session_key_version: encrypted.keyVersion,
        user_id: userId,
      },
      { onConflict: "user_id" },
    );

    if (error) {
      throw new SessionStorageError();
    }
  }

  async load(userId: string): Promise<Uint8Array | null> {
    const { data, error } = await this.supabase
      .from("riot_connections")
      .select("encrypted_jar, jar_nonce, session_key_version")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new SessionStorageError();
    }

    if (!data) {
      return null;
    }

    return this.cipher.decrypt(userId, storedValue(data));
  }

  async delete(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from("riot_connections")
      .delete()
      .eq("user_id", userId);

    if (error) {
      throw new SessionStorageError();
    }
  }
}
