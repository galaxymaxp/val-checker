import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { syncCatalog } from "../src/lib/catalog/sync.ts";
import {
  fetchValorantCatalog,
  fetchValorantContentTiers,
} from "../src/lib/catalog/valorant-api.ts";
import type { Database } from "../src/types/database.ts";

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
    throw new Error("Catalog sync requires the local Supabase stack.");
  }
}

/**
 * Resolves the sync target. An explicit remote URL plus secret key wins so the
 * hosted catalog can be synced without Docker; otherwise the local stack is
 * used, which keeps the default developer workflow unchanged.
 */
function syncTarget() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && key) {
    return { API_URL: url, SERVICE_ROLE_KEY: key };
  }

  return localSupabaseStatus();
}

try {
  const status = syncTarget();
  const supabase = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const [snapshot, tierSnapshot] = await Promise.all([
    fetchValorantCatalog(),
    fetchValorantContentTiers(),
  ]);
  const counts = await syncCatalog(supabase, snapshot, tierSnapshot);

  console.log(
    `Catalog sync complete: ${counts.weapons} weapons, ${counts.skins} skins, ` +
      `${counts.skinLevels} skin levels, ${counts.skinChromas} chromas, ` +
      `${counts.contentTiers} content tiers.`,
  );
} catch (error) {
  const message =
    error instanceof z.ZodError
      ? "Valorant catalog response failed validation."
      : error instanceof Error
        ? error.message
        : "Catalog sync failed.";
  console.error(message);
  process.exitCode = 1;
}
