import "server-only";

import {
  createStorefrontEmailDeliveryService,
  ResendEmailProvider,
  StorefrontEmailDeliveryError,
} from "@/src/lib/notifications/resend-delivery";
import { renderSessionExpiredEmail } from "@/src/lib/notifications/session-expired";
import { RiotClient } from "@/src/lib/riot/client";
import { loadRiotConnectAllowlist } from "@/src/lib/riot/connect-allowlist";
import {
  AesGcmSessionCipher,
  loadSessionKeyring,
} from "@/src/lib/riot/session-crypto";
import { SupabaseEncryptedSessionStore } from "@/src/lib/riot/session-store";
import { planStorefrontNotificationsWithClient } from "@/src/lib/storefront/pipeline";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { SupabaseDailyStorefrontRepository } from "@/src/lib/worker/storefront-repository";
import { DailyStorefrontWorker } from "@/src/lib/worker/storefront-worker";

/**
 * Builds the worker from runtime configuration. Passing a userId narrows the
 * run to that user; the per-connection daily claim bounds Riot work regardless.
 */
export async function buildConfiguredDailyStorefrontWorker(
  onlyUserId?: string,
): Promise<DailyStorefrontWorker> {
  const supabase = createAdminSupabaseClient();
  const sessionStore = new SupabaseEncryptedSessionStore(
    supabase,
    new AesGcmSessionCipher(loadSessionKeyring()),
  );
  const allowlist = loadRiotConnectAllowlist();
  const repository = new SupabaseDailyStorefrontRepository(supabase, onlyUserId);
  const storefrontDelivery = createStorefrontEmailDeliveryService(supabase);
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    throw new StorefrontEmailDeliveryError();
  }
  const expiryProvider = new ResendEmailProvider(apiKey);

  return new DailyStorefrontWorker({
    allowlist,
    createRiotClient: ({ region, session }) =>
      new RiotClient({ account: { region }, session }),
    pipeline: (input) => planStorefrontNotificationsWithClient(supabase, input),
    repository,
    sendExpiry: async ({ email, idempotencyKey }) => {
      const rendered = renderSessionExpiredEmail({
        connection: "disconnected",
        reason: "session-expired",
      });
      if (!rendered) {
        throw new StorefrontEmailDeliveryError();
      }
      await expiryProvider.send({
        from,
        html: rendered.html,
        idempotencyKey,
        subject: rendered.subject,
        to: email,
      });
    },
    sendStorefront: async (input) => {
      const { emailsSent } = await storefrontDelivery.deliver({
        canonicalStorefront: input.canonicalStorefront,
        checkedAt: input.checkedAt,
        connectionId: input.connectionId,
        emails: input.emails,
        userId: input.userId,
      });
      return { emailsSent };
    },
    sessionStore,
  });
}

export async function runConfiguredDailyStorefrontCron() {
  const worker = await buildConfiguredDailyStorefrontWorker();
  return worker.run();
}
