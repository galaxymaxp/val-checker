import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/src/lib/supabase/server";

const emailOtpTypes = new Set<EmailOtpType>([
  "email",
  "email_change",
  "invite",
  "magiclink",
  "recovery",
  "signup",
]);

function safeNextPath(candidate: string | null) {
  if (!candidate?.startsWith("/")) {
    return "/dashboard";
  }

  const localOrigin = "http://local";
  const destination = new URL(candidate, localOrigin);

  return destination.origin === localOrigin
    ? `${destination.pathname}${destination.search}${destination.hash}`
    : "/dashboard";
}

export async function GET(request: NextRequest) {
  const parameters = request.nextUrl.searchParams;
  const code = parameters.get("code");
  const tokenHash = parameters.get("token_hash");
  const type = parameters.get("type");
  const next = safeNextPath(parameters.get("next"));
  const supabase = await createServerSupabaseClient();
  let succeeded = false;

  if (tokenHash && type && emailOtpTypes.has(type as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    succeeded = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    succeeded = !error;
  }

  if (succeeded) {
    return NextResponse.redirect(new URL(next, request.url));
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("error", "invalid_or_expired_link");
  return NextResponse.redirect(signInUrl);
}
