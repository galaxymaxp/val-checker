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
  const skinUuid = offer.skinUuid ?? offer.offerId ?? "unknown-skin";

  // Resolve a readable name where the catalog knows one; the email still
  // renders correctly without it.
  let skinName = "A watched skin";
  if (offer.skinUuid) {
    const { data: skin } = await admin
      .from("skins")
      .select("display_name")
      .eq("skin_uuid", offer.skinUuid)
      .maybeSingle();
    skinName = skin?.display_name ?? skinName;
  }

  const rendered = renderStorefrontMatchEmail({
    displayName: skinName,
    expiresAt: shop?.expires_at ?? new Date().toISOString(),
    match: {
      offers: [
        {
          costs: offer.costs ?? [],
          offerId: offer.offerId ?? skinUuid,
          rewards: offer.rewards ?? [],
        },
      ] as never,
      skinUuid,
    },
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
