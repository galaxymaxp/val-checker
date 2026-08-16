import Link from "next/link";
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
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6 py-16">
      {/* Faint accent glow behind the column; the body gradients stay subtle. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-accent opacity-[0.06] blur-3xl"
      />

      <div className="relative flex w-full max-w-[26rem] flex-col gap-4 motion-safe:animate-rise">
        <Link
          className="w-fit text-sm text-ink-dim! no-underline transition-colors hocus:text-ink!"
          href="/"
        >
          ← Back
        </Link>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-widest text-ink-dim">
            PASSWORDLESS ACCESS
          </p>
          <h1 className="text-4xl! font-semibold tracking-tight">
            Sign in by email.
          </h1>
          <p className="text-ink-muted">
            We send a one-time link. No password to remember, nothing to
            install.
          </p>
        </div>

        <SignInForm
          linkError={firstValue(parameters.error) === "invalid_or_expired_link"}
        />
      </div>
    </main>
  );
}
