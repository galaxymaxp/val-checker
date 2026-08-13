import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { CatalogSnapshot } from "@/src/lib/catalog/valorant-api";
import { syncCatalog } from "@/src/lib/catalog/sync";
import type { Database } from "@/src/types/database";

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
    throw new Error("The local Supabase stack must be running for catalog sync tests.");
  }
}

async function catalogCounts(supabase: ReturnType<typeof createClient<Database>>) {
  const [weapons, skins, levels] = await Promise.all([
    supabase.from("weapons").select("*", { count: "exact", head: true }),
    supabase.from("skins").select("*", { count: "exact", head: true }),
    supabase.from("skin_levels").select("*", { count: "exact", head: true }),
  ]);

  expect(weapons.error).toBeNull();
  expect(skins.error).toBeNull();
  expect(levels.error).toBeNull();

  return {
    skinLevels: levels.count,
    skins: skins.count,
    weapons: weapons.count,
  };
}

describe("catalog sync", () => {
  it("is idempotent and preserves first-seen timestamps", async () => {
    const status = localSupabaseStatus();
    const admin = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const weaponUuid = randomUUID();
    const skinUuid = randomUUID();
    const levelUuid = randomUUID();
    const snapshot: CatalogSnapshot = {
      weapons: [
        { category: "Rifle", display_name: "Sync fixture", weapon_uuid: weaponUuid },
      ],
      skins: [
        {
          content_tier: null,
          display_icon: null,
          display_name: "Sync fixture skin",
          skin_uuid: skinUuid,
          weapon_uuid: weaponUuid,
        },
      ],
      skinLevels: [{ level_uuid: levelUuid, ordinal: 0, skin_uuid: skinUuid }],
    };

    await syncCatalog(admin, snapshot);
    const countsAfterFirstSync = await catalogCounts(admin);
    const { data: firstSeen, error: firstSeenError } = await admin
      .from("skins")
      .select("first_seen_at")
      .eq("skin_uuid", skinUuid)
      .single();
    const { data: firstLevelSeen, error: firstLevelSeenError } = await admin
      .from("skin_levels")
      .select("first_seen_at")
      .eq("level_uuid", levelUuid)
      .single();

    expect(firstSeenError).toBeNull();
    expect(firstLevelSeenError).toBeNull();

    await syncCatalog(admin, {
      ...snapshot,
      skins: [{ ...snapshot.skins[0], display_name: "Sync fixture skin updated" }],
    });

    const countsAfterSecondSync = await catalogCounts(admin);
    const { data: secondSeen, error: secondSeenError } = await admin
      .from("skins")
      .select("display_name, first_seen_at")
      .eq("skin_uuid", skinUuid)
      .single();
    const { data: secondLevelSeen, error: secondLevelSeenError } = await admin
      .from("skin_levels")
      .select("first_seen_at")
      .eq("level_uuid", levelUuid)
      .single();

    expect(secondSeenError).toBeNull();
    expect(secondLevelSeenError).toBeNull();
    expect(countsAfterSecondSync).toEqual(countsAfterFirstSync);
    expect(secondSeen?.display_name).toBe("Sync fixture skin updated");
    expect(secondSeen?.first_seen_at).toBe(firstSeen?.first_seen_at);
    expect(secondLevelSeen?.first_seen_at).toBe(firstLevelSeen?.first_seen_at);
  });
});
