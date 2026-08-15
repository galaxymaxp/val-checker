import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { getPublicSupabaseConfig } from "@/src/lib/supabase/public-env";

const PKCE_TOKEN_PREFIX = "pkce_";

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

  // The session cookies must be written onto the response this handler
  // actually returns. Writing them through next/headers is silently dropped on
  // a redirect, which produced a sign-in loop: Supabase created the session but
  // the browser never received it.
  const response = NextResponse.redirect(new URL(next, request.url));
  const { key, url } = getPublicSupabaseConfig();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, options, value } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  let succeeded = false;

  // A PKCE-issued token arrives in token_hash but must be exchanged, not
  // verified. @supabase/ssr defaults the browser client to the PKCE flow, so
  // signInWithOtp mints a "pkce_" token whose shape verifyOtp cannot accept.
  const pkceToken = tokenHash?.startsWith(PKCE_TOKEN_PREFIX) ? tokenHash : code;

  if (pkceToken) {
    const { error } = await supabase.auth.exchangeCodeForSession(pkceToken);
    succeeded = !error;
  } else if (tokenHash && type && emailOtpTypes.has(type as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    succeeded = !error;
  }

  if (succeeded) {
    return response;
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("error", "invalid_or_expired_link");
  return NextResponse.redirect(signInUrl);
}
