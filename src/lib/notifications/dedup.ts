import type { StorefrontSkinMatch } from "@/src/lib/storefront/match";

export interface SentStorefrontNotification {
  readonly skinUuid: string;
  /** UTC store-rotation date in YYYY-MM-DD form. */
  readonly storeDate: string;
}

export interface StorefrontNotificationDecision {
  readonly duplicates: readonly StorefrontSkinMatch[];
  readonly toSend: readonly StorefrontSkinMatch[];
}

/**
 * Pure planning decision only. The persistence layer must reserve the same
 * user/skin/storeDate key atomically before sending.
 */
export function decideStorefrontNotificationDedup(
  matches: readonly StorefrontSkinMatch[],
  storeDate: string,
  sentNotifications: readonly SentStorefrontNotification[],
): StorefrontNotificationDecision {
  const sentToday = new Set(
    sentNotifications
      .filter((notification) => notification.storeDate === storeDate)
      .map((notification) => notification.skinUuid),
  );
  const duplicates: StorefrontSkinMatch[] = [];
  const toSend: StorefrontSkinMatch[] = [];

  for (const match of matches) {
    (sentToday.has(match.skinUuid) ? duplicates : toSend).push(match);
  }

  return { duplicates, toSend };
}
