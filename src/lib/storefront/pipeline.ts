import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveSkinLevelsWithClient } from "@/src/lib/catalog/resolve-skin-uuids";
import {
  decideStorefrontNotificationDedup,
  type SentStorefrontNotification,
  type StorefrontNotificationDecision,
} from "@/src/lib/notifications/dedup";
import type { RenderedEmail } from "@/src/lib/notifications/session-expired";
import { renderStorefrontMatchEmail } from "@/src/lib/notifications/storefront-match";
import type { FetchedStorefront } from "@/src/lib/riot/adapter";
import {
  canonicalizeStorefront,
  type CanonicalStorefront,
} from "@/src/lib/storefront/canonicalize";
import {
  matchStorefrontWatchlist,
  type StorefrontSkinMatch,
} from "@/src/lib/storefront/match";
import {
  extractStorefrontSkinLevelUuids,
  parseStorefrontPayload,
} from "@/src/lib/storefront/schema";
import { loadWatchedSkinUuidsForUser } from "@/src/lib/watchlist/load";
import type { Database } from "@/src/types/database";

export interface StorefrontPipelineInput {
  readonly checkedAt: Date;
  readonly sentNotifications: readonly SentStorefrontNotification[];
  readonly storefront: FetchedStorefront;
  readonly userId: string;
}

export interface PlannedStorefrontEmail {
  readonly email: RenderedEmail;
  readonly skinUuid: string;
}

export interface StorefrontPipelineResult {
  readonly canonicalStorefront: CanonicalStorefront;
  readonly decision: StorefrontNotificationDecision;
  readonly emails: readonly PlannedStorefrontEmail[];
  readonly matches: readonly StorefrontSkinMatch[];
}

async function loadSkinDisplayNames(
  supabase: SupabaseClient<Database>,
  skinUuids: readonly string[],
): Promise<Map<string, string>> {
  const uniqueSkinUuids = [...new Set(skinUuids)];
  if (uniqueSkinUuids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("skins")
    .select("skin_uuid, display_name")
    .in("skin_uuid", uniqueSkinUuids);

  if (error) {
    throw new Error("Storefront email rendering failed while reading the catalog.");
  }

  const displayNameBySkin = new Map(
    (data ?? []).map(({ display_name, skin_uuid }) => [skin_uuid, display_name]),
  );
  if (uniqueSkinUuids.some((skinUuid) => !displayNameBySkin.has(skinUuid))) {
    throw new Error("Storefront email rendering failed while reading the catalog.");
  }

  return displayNameBySkin;
}

/**
 * Fetch-free worker pipeline. The caller supplies the one Storefront returned
 * by RiotAdapter and any already-sent daily notification records.
 */
export async function planStorefrontNotificationsWithClient(
  supabase: SupabaseClient<Database>,
  input: StorefrontPipelineInput,
): Promise<StorefrontPipelineResult> {
  const parsedStorefront = parseStorefrontPayload(input.storefront.payload);
  const levelUuids = extractStorefrontSkinLevelUuids(parsedStorefront);
  const [resolvedLevels, watchedSkinUuids] = await Promise.all([
    resolveSkinLevelsWithClient(supabase, levelUuids),
    loadWatchedSkinUuidsForUser(supabase, input.userId),
  ]);
  const canonicalStorefront = canonicalizeStorefront(
    parsedStorefront,
    resolvedLevels,
    input.checkedAt,
  );
  const matches = matchStorefrontWatchlist(
    canonicalStorefront,
    watchedSkinUuids,
  );
  const decision = decideStorefrontNotificationDedup(
    matches,
    canonicalStorefront.storeDate,
    input.sentNotifications,
  );
  const displayNameBySkin = await loadSkinDisplayNames(
    supabase,
    decision.toSend.map(({ skinUuid }) => skinUuid),
  );
  const emails = decision.toSend.map((match) => ({
    email: renderStorefrontMatchEmail({
      displayName: displayNameBySkin.get(match.skinUuid)!,
      expiresAt: canonicalStorefront.expiresAt,
      match,
    }),
    skinUuid: match.skinUuid,
  }));

  return { canonicalStorefront, decision, emails, matches };
}
