import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { CapturedSession } from "@/src/lib/riot/session-provider";
import {
  AesGcmSessionCipher,
  loadSessionKeyring,
} from "@/src/lib/riot/session-crypto";
import {
  SessionStorageError,
  SupabaseEncryptedSessionStore,
} from "@/src/lib/riot/session-store";
import type { Database } from "@/src/types/database";

vi.mock("server-only", () => ({}));

function cipher(): AesGcmSessionCipher {
  return new AesGcmSessionCipher(
    loadSessionKeyring({
      SESSION_ENCRYPTION_CURRENT_VERSION: "1",
      SESSION_ENCRYPTION_KEY_V1: randomBytes(32).toString("base64"),
    }),
  );
}

function rotatedSession(): CapturedSession {
  return {
    capturedAt: "2026-08-14T11:00:00.000Z",
    fixtureOnly: false,
    kind: "captured-session",
    material: new TextEncoder().encode("sensitive-rotated-cookie-jar"),
    provider: "manual-cookie",
  };
}

function updateClient(result: { data: { id: string } | null; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(
    (value: Database["public"]["Tables"]["riot_connections"]["Update"]) => {
      void value;
      return { eq };
    },
  );
  const from = vi.fn(() => ({ update }));

  return {
    eq,
    from,
    select,
    supabase: { from } as unknown as SupabaseClient<Database>,
    update,
  };
}

describe("rotated session storage", () => {
  it("updates the encrypted fields atomically without lifecycle or account metadata", async () => {
    const client = updateClient({ data: { id: "connection-id" }, error: null });
    const store = new SupabaseEncryptedSessionStore(client.supabase, cipher());

    await store.persistRotated("user-id", rotatedSession());

    expect(client.from).toHaveBeenCalledWith("riot_connections");
    expect(client.eq).toHaveBeenCalledWith("user_id", "user-id");
    expect(client.select).toHaveBeenCalledWith("id");
    expect(client.update).toHaveBeenCalledTimes(1);
    const update = client.update.mock.calls[0]?.[0];
    expect(Object.keys(update ?? {}).sort()).toEqual([
      "encrypted_jar",
      "jar_nonce",
      "last_refresh_at",
      "session_key_version",
    ]);
    expect(update).toMatchObject({
      last_refresh_at: "2026-08-14T11:00:00.000Z",
      session_key_version: 1,
    });
    expect(JSON.stringify(update)).not.toContain("sensitive-rotated-cookie-jar");
  });

  it("fails closed when the existing connection cannot be updated", async () => {
    const sensitiveMarker = "database-detail-with-session-marker";
    const client = updateClient({
      data: null,
      error: { message: sensitiveMarker },
    });
    const store = new SupabaseEncryptedSessionStore(client.supabase, cipher());

    try {
      await store.persistRotated("user-id", rotatedSession());
      expect.unreachable("A failed rotation must fail the run.");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionStorageError);
      expect((error as Error).message).not.toContain(sensitiveMarker);
    }
  });
});
