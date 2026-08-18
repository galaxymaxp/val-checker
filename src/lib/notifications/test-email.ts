import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ResendEmailProvider } from "@/src/lib/notifications/resend-delivery";
import { renderStorefrontMatchEmail } from "@/src/lib/notifications/storefront-match";
import type { Database } from "@/src/types/database";

export type TestEmailResult =
  | { readonly ok: true; readonly skinName: string }
  | { readonly error: string; readonly ok: false };

/** Shape the worker persists into shop_checks.offer_details. */
interface StoredOffer {
  readonly offerId?: string;
  readonly costs?: readonly {
    readonly amount: number;
    readonly currencyUuid: string;
  }[];
  readonly rewards?: readonly { readonly itemId?: string }[];
  readonly skinUuid?: string | null;
}

/**
 * Sends one sample notification to the signed-in user, built from a random
 * offer in their most recent stored storefront and rendered with the very
 * same template the watchlist notifications use, so what arrives is what a
 * real match would look like.
 *
 * Deliberately writes nothing: no notification row, no dedup reservation, no
 * allowance spent. It reads a stored store and sends, so it can be used
 * repeatedly to verify delivery without affecting real notifications.
 */
export async function sendStorefrontTestEmail(
  admin: SupabaseClient<Database>,
  userId: string,
  recipient: string,
): Promise<TestEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    return { error: "Email delivery is not configured.", ok: false };
  }

  const { data: connections } = await admin
    .from("riot_connections")
    .select("id")
    .eq("user_id", userId);

  if (!connections || connections.length === 0) {
    return { error: "Connect a Riot account first.", ok: false };
  }

  const { data: shop } = await admin
    .from("shop_checks")
    .select("offer_details, expires_at")
    .in(
      "connection_id",
      connections.map((row) => row.id),
    )
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const offers = (shop?.offer_details ?? []) as readonly StoredOffer[];
  if (!Array.isArray(offers) || offers.length === 0) {
    return { error: "No store has been fetched yet.", ok: false };
  }

  const offer = offers[Math.floor(Math.random() * offers.length)]!;

  // offer_details carries a resolved skin uuid once the catalog has matched
  // the offer; older rows and unsynced skins fall back to the offer id, which
  // is what the level uuid is keyed on.
  const lookupUuid = offer.skinUuid ?? offer.offerId ?? null;

  let skinName = "A watched skin";
  let imageUrl: string | null = null;
  if (lookupUuid) {
    const { data: skin } = await admin
      .from("skins")
      .select("display_name, display_icon, full_render")
      .eq("skin_uuid", lookupUuid)
      .maybeSingle();
    if (skin) {
      skinName = skin.display_name ?? skinName;
      imageUrl = skin.full_render ?? skin.display_icon ?? null;
    }
  }

  // Valorant Points is the only currency worth showing; anything else is a
  // promo currency and is left out rather than rendered as a raw uuid.
  const VP_CURRENCY_UUID = "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741";
  const costs = offer.costs ?? [];
  const priceVp =
    costs.find(
      (cost: { amount: number; currencyUuid: string }) =>
        cost.currencyUuid === VP_CURRENCY_UUID,
    )?.amount ??
    costs[0]?.amount ??
    null;

  const rendered = renderStorefrontMatchEmail({
    displayName: skinName,
    expiresAt: shop?.expires_at ?? new Date().toISOString(),
    imageUrl,
    match: { offers: [], skinUuid: lookupUuid ?? "unknown-skin" },
    priceVp,
  });

  try {
    await new ResendEmailProvider(apiKey).send({
      from,
      html: rendered.html,
      // A fresh key each send, so repeated tests are not deduplicated away.
      idempotencyKey: `test-${userId}-${Date.now()}`,
      subject: `[Test] ${rendered.subject}`,
      to: recipient,
    });
  } catch {
    return { error: "The test email could not be sent.", ok: false };
  }

  return { ok: true, skinName };
}
