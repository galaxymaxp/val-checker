"use client";

import { type FormEvent, useState } from "react";

import { createBrowserSupabaseClient } from "@/src/lib/supabase/browser";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function requestMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(undefined);

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
      },
    });

    setIsSubmitting(false);
    setMessage(
      error
        ? "We could not send a sign-in link. Please try again."
        : "Check your email for a one-time sign-in link.",
    );
  }

  return (
    <main className="shell auth-shell">
      <p className="eyebrow">PASSWORDLESS ACCESS</p>
      <h1>Sign in by email.</h1>
      <p className="lede">We will send you a one-time link. No password is required.</p>
      <form className="auth-form" onSubmit={requestMagicLink}>
        <label htmlFor="email">Email address</label>
        <input
          autoComplete="email"
          id="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
      {message ? <p aria-live="polite">{message}</p> : null}
    </main>
  );
}
