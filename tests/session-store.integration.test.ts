import { execFileSync } from "node:child_process";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  ManualCookieProvider,
  SubmittedCookieProvider,
} from "@/src/lib/riot/session-provider";
import {
  AesGcmSessionCipher,
  loadSessionKeyring,
} from "@/src/lib/riot/session-crypto";
import { SupabaseEncryptedSessionStore } from "@/src/lib/riot/session-store";
import type { Database } from "@/src/types/database";

vi.mock("server-only", () => ({}));

const localStatusSchema = z.object({
  API_URL: z.url(),
  SERVICE_ROLE_KEY: z.string().min(1),
});

function localSupabaseStatus() {
  const root = process.cwd();
  const cli = path.join(root, "node_modules", "supabase", "dist", "supabase.js");
  const environment = { ...process.env };

  if (process.platform === "win32" && environment.LOCALAPPDATA) {
    const dockerBin = path.join(
      environment.LOCALAPPDATA,
      "Programs",
      "DockerDesktop",
      "resources",
      "bin",
    );
    environment.PATH = `${dockerBin}${path.delimiter}${environment.PATH ?? ""}`;
  }

  try {
    const output = execFileSync(
      process.execPath,
      [cli, "--workdir", root, "status", "-o", "json"],
      {
        cwd: root,
        encoding: "utf8",
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return localStatusSchema.parse(JSON.parse(output));
  } catch {
    throw new Error("The local Supabase stack must be running for session storage tests.");
  }
}

function sameValue(left: Uint8Array, right: Uint8Array): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

describe("encrypted Supabase session storage", () => {
  it("persists only encrypted fixture material and removes it on disconnect", async () => {
    const status = localSupabaseStatus();
    const admin = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const email = `session-store-${randomUUID()}@example.test`;
    const password = `A-${randomUUID()}-9!`;
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password,
      });

    expect(createError).toBeNull();
    const userId = created.user?.id;
    expect(userId).toBeDefined();
    if (!userId) {
      return;
    }

    try {
      const cipher = new AesGcmSessionCipher(
        loadSessionKeyring({
          SESSION_ENCRYPTION_CURRENT_VERSION: "1",
          SESSION_ENCRYPTION_KEY_V1: randomBytes(32).toString("base64"),
        }),
      );
      const store = new SupabaseEncryptedSessionStore(admin, cipher);
      const fixtureMaterial = randomBytes(64);
      const session = await new ManualCookieProvider().capture({
        fixtureOnly: true,
        serializedJar: fixtureMaterial,
      });

      await store.save(userId, session);

      const { data: persisted, error: readError } = await admin
        .from("riot_connections")
        .select("*")
        .eq("user_id", userId)
        .single();
      expect(readError).toBeNull();
      expect(persisted?.session_key_version).toBe(1);
      expect(Object.keys(persisted ?? {})).not.toContain("encryption_key");

      const loaded = await store.load(userId);
      expect(loaded).not.toBeNull();
      expect(loaded ? sameValue(loaded, fixtureMaterial) : false).toBe(true);

      const submittedJar = JSON.stringify([
        {
          domain: ".riotgames.com",
          name: "ssid",
          path: "/",
          value: "offline-submitted-session-value",
        },
      ]);
      const submittedSession = await new SubmittedCookieProvider().capture({
        serializedJar: submittedJar,
      });
      await store.save(userId, submittedSession, { region: "ap" });

      const { data: submittedRow, error: submittedReadError } = await admin
        .from("riot_connections")
        .select("encrypted_jar, region")
        .eq("user_id", userId)
        .single();
      expect(submittedReadError).toBeNull();
      expect(submittedRow?.region).toBe("ap");
      expect(JSON.stringify(submittedRow)).not.toContain(
        "offline-submitted-session-value",
      );
      const loadedSubmission = await store.load(userId);
      expect(loadedSubmission).not.toBeNull();
      expect(
        loadedSubmission
          ? sameValue(loadedSubmission, new TextEncoder().encode(submittedJar))
          : false,
      ).toBe(true);

      await store.delete(userId);
      await expect(store.load(userId)).resolves.toBeNull();
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });
});
