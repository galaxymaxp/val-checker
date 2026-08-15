import { redirect } from "next/navigation";

import { SignInForm } from "@/app/(auth)/sign-in/sign-in-form";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

interface SignInPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();

  // An already-authenticated visitor previously saw the request form with no
  // indication they were signed in, which reads as a broken sign-in loop.
  if (data?.claims.sub) {
    redirect("/dashboard");
  }

  const parameters = await searchParams;

  return (
    <main className="shell auth-shell">
      <p className="eyebrow">PASSWORDLESS ACCESS</p>
      <h1>Sign in by email.</h1>
      <p className="lede">
        We send a one-time link. No password to remember, nothing to install.
      </p>
      <SignInForm linkError={firstValue(parameters.error) === "invalid_or_expired_link"} />
    </main>
  );
}
