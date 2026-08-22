import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type EmailDeliveryProvider,
  ResendEmailProvider,
} from "@/src/lib/notifications/resend-delivery";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import type { Database } from "@/src/types/database";

const IDEMPOTENCY_PREFIX = "val-checker/account-created/";

export class AccountCreationNotificationError extends Error {
  constructor() {
    super("Account creation notification delivery failed.");
    this.name = "AccountCreationNotificationError";
  }
}

export interface AccountCreationNotificationOptions {
  readonly from: string;
  readonly ownerEmail: string;
  readonly now?: () => Date;
}

export type AccountCreationNotificationResult = "sent" | "skipped";

export class AccountCreationNotificationService {
  private readonly from: string;
  private readonly now: () => Date;
  private readonly ownerEmail: string;

  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly provider: EmailDeliveryProvider,
    options: AccountCreationNotificationOptions,
  ) {
    const from = options.from.trim();
    const ownerEmail = options.ownerEmail.trim();
    if (!from || !ownerEmail || /[\r\n]/.test(from + ownerEmail)) {
      throw new AccountCreationNotificationError();
    }

    this.from = from;
    this.ownerEmail = ownerEmail;
    this.now = options.now ?? (() => new Date());
  }

  async deliver(userId: string): Promise<AccountCreationNotificationResult> {
    const signupAt = await this.claim(userId);
    if (!signupAt) {
      return "skipped";
    }

    const signupTimestamp = new Date(signupAt);
    if (!Number.isFinite(signupTimestamp.getTime())) {
      throw new AccountCreationNotificationError();
    }

    try {
      await this.provider.send({
        from: this.from,
        html: [
          "<!doctype html>",
          '<html lang="en">',
          "<body>",
          "<p>A new VAL Checker account was created.</p>",
          `<p>Signup timestamp: ${signupTimestamp.toISOString()}</p>`,
          "</body>",
          "</html>",
        ].join(""),
        idempotencyKey: `${IDEMPOTENCY_PREFIX}${userId}`,
        subject: "New VAL Checker account created",
        to: this.ownerEmail,
      });
    } catch {
      throw new AccountCreationNotificationError();
    }

    const emailedAt = this.now();
    if (!Number.isFinite(emailedAt.getTime())) {
      throw new AccountCreationNotificationError();
    }

    const { data, error } = await this.supabase
      .from("account_creation_notifications")
      .update({ emailed_at: emailedAt.toISOString() })
      .eq("user_id", userId)
      .select("user_id")
      .single();

    if (error || !data) {
      throw new AccountCreationNotificationError();
    }

    return "sent";
  }

  private async claim(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase.rpc(
      "claim_account_creation_notification",
      { p_user_id: userId },
    );
    if (error) {
      throw new AccountCreationNotificationError();
    }

    return data?.[0]?.signup_at ?? null;
  }
}

interface AccountCreationNotificationEnvironment {
  readonly RESEND_API_KEY?: string;
  readonly RESEND_FROM_EMAIL?: string;
  readonly VAL_CHECKER_OWNER_EMAIL?: string;
}

export function createAccountCreationNotificationService(
  supabase: SupabaseClient<Database>,
  environment: AccountCreationNotificationEnvironment = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    VAL_CHECKER_OWNER_EMAIL: process.env.VAL_CHECKER_OWNER_EMAIL,
  },
): AccountCreationNotificationService {
  const apiKey = environment.RESEND_API_KEY?.trim();
  const from = environment.RESEND_FROM_EMAIL?.trim();
  const ownerEmail = environment.VAL_CHECKER_OWNER_EMAIL?.trim();
  if (!apiKey || !from || !ownerEmail) {
    throw new AccountCreationNotificationError();
  }

  return new AccountCreationNotificationService(
    supabase,
    new ResendEmailProvider(apiKey),
    { from, ownerEmail },
  );
}

export async function deliverPendingAccountCreationNotification(
  userId: string,
): Promise<AccountCreationNotificationResult> {
  return createAccountCreationNotificationService(
    createAdminSupabaseClient(),
  ).deliver(userId);
}
