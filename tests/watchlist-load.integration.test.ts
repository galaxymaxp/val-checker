import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadWatchedSkinUuids } from "@/src/lib/watchlist/load";
import type { Database } from "@/src/types/database";

const localStatusSchema = z.object({
  ANON_KEY: z.string().min(1),
  API_URL: z.url(),
  SERVICE_ROLE_KEY: z.string().min(1),
});

const ROW_COUNT = 1_005;

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
    throw new Error("The local Supabase stack must be running for watchlist loader tests.");
  }
}

function makeUuid(prefix: string, ordinal: number) {
  return `${prefix}-0000-0000-0000-${ordinal.toString(16).padStart(12, "0")}`;
}

function batches<Row>(rows: readonly Row[], size = 250) {
  const result: Row[][] = [];

  for (let offset = 0; offset < rows.length; offset += size) {
    result.push(rows.slice(offset, offset + size));
  }

  return result;
}

describe("watchlist loader pagination", () => {
  it(
    "loads every watched skin across the Data API page boundary",
    async () => {
      const status = localSupabaseStatus();
      const admin = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      });
      const identity = randomUUID();
      const email = `watchlist-pagination-${identity}@example.test`;
      const password = `Local-only-${identity}!`;
      const weaponUuid = randomUUID();
      const uuidPrefix = randomUUID().slice(0, 8);
      const skinUuids = Array.from({ length: ROW_COUNT }, (_, ordinal) =>
        makeUuid(uuidPrefix, ordinal),
      );
      let userId: string | undefined;

      try {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          password,
        });

        expect(createError).toBeNull();
        expect(created.user).not.toBeNull();
        userId = created.user?.id;

        if (!userId) {
          throw new Error("Unable to create the local watchlist pagination user.");
        }

        const verifiedUserId = userId;

        const userClient = createClient<Database>(status.API_URL, status.ANON_KEY, {
          auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
          },
        });
        const { error: signInError } = await userClient.auth.signInWithPassword({
          email,
          password,
        });

        expect(signInError).toBeNull();
        expect(
          (
            await admin.from("weapons").insert({
              category: "Rifle",
              display_name: "Watchlist pagination fixture",
              weapon_uuid: weaponUuid,
            })
          ).error,
        ).toBeNull();

        for (const batch of batches(
          skinUuids.map((skinUuid, ordinal) => ({
            content_tier: null,
            display_icon: null,
            display_name: `Pagination fixture ${ordinal}`,
            skin_uuid: skinUuid,
            weapon_uuid: weaponUuid,
          })),
        )) {
          expect((await admin.from("skins").insert(batch)).error).toBeNull();
        }

        const createdAt = "2026-08-14T00:00:00.000Z";
        const watchRows = skinUuids.map((skinUuid, ordinal) => ({
          created_at: createdAt,
          id: makeUuid(uuidPrefix, ordinal),
          skin_uuid: skinUuid,
          user_id: verifiedUserId,
        }));

        for (const batch of batches(watchRows.toReversed())) {
          expect((await admin.from("watchlist").insert(batch)).error).toBeNull();
        }

        const loaded = await loadWatchedSkinUuids(userClient);

        expect(loaded).toEqual(skinUuids);
        expect(loaded).toHaveLength(ROW_COUNT);
        expect(new Set(loaded).size).toBe(ROW_COUNT);
      } finally {
        if (userId) {
          await admin.from("watchlist").delete().eq("user_id", userId);
          await admin.auth.admin.deleteUser(userId);
        }

        await admin.from("skins").delete().eq("weapon_uuid", weaponUuid);
        await admin.from("weapons").delete().eq("weapon_uuid", weaponUuid);
      }
    },
    120_000,
  );
});
