import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  resolveSkinUuidsWithClient,
  UnknownSkinLevelsError,
} from "@/src/lib/catalog/resolve-skin-uuids";
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
    throw new Error("The local Supabase stack must be running for resolver tests.");
  }
}

describe("SkinLevel-to-Skin resolver", () => {
  it("maps storefront level UUIDs to their parent skin UUIDs", async () => {
    const status = localSupabaseStatus();
    const admin = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const weaponUuid = randomUUID();
    const firstSkinUuid = randomUUID();
    const secondSkinUuid = randomUUID();
    const firstLevelUuid = randomUUID();
    const duplicateParentLevelUuid = randomUUID();
    const secondLevelUuid = randomUUID();
    const fixtureStorefront = {
      SingleItemOffers: [firstLevelUuid, duplicateParentLevelUuid, secondLevelUuid],
    };

    expect(firstLevelUuid).not.toBe(firstSkinUuid);

    expect(
      (
        await admin.from("weapons").insert({
          category: "Rifle",
          display_name: "Resolver fixture",
          weapon_uuid: weaponUuid,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await admin.from("skins").insert([
          {
            content_tier: null,
            display_icon: null,
            display_name: "Resolver fixture one",
            skin_uuid: firstSkinUuid,
            weapon_uuid: weaponUuid,
          },
          {
            content_tier: null,
            display_icon: null,
            display_name: "Resolver fixture two",
            skin_uuid: secondSkinUuid,
            weapon_uuid: weaponUuid,
          },
        ])
      ).error,
    ).toBeNull();
    expect(
      (
        await admin.from("skin_levels").insert([
          { level_uuid: firstLevelUuid, ordinal: 0, skin_uuid: firstSkinUuid },
          {
            level_uuid: duplicateParentLevelUuid,
            ordinal: 1,
            skin_uuid: firstSkinUuid,
          },
          { level_uuid: secondLevelUuid, ordinal: 0, skin_uuid: secondSkinUuid },
        ])
      ).error,
    ).toBeNull();

    await expect(
      resolveSkinUuidsWithClient(admin, fixtureStorefront.SingleItemOffers),
    ).resolves.toEqual([firstSkinUuid, secondSkinUuid]);
  });

  it("surfaces every unknown level instead of silently dropping it", async () => {
    const status = localSupabaseStatus();
    const admin = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY);
    const unknownLevelUuid = randomUUID();

    try {
      await resolveSkinUuidsWithClient(admin, [unknownLevelUuid]);
      expect.unreachable("The resolver must surface a stale catalog.");
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownSkinLevelsError);
      expect((error as UnknownSkinLevelsError).unknownLevelUuids).toEqual([
        unknownLevelUuid,
      ]);
    }
  });
});
