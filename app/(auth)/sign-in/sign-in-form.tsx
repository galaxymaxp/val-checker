"use client";

import { type FormEvent, useState } from "react";

import { createMagicLinkRequestClient } from "@/src/lib/supabase/browser";

type Status = "idle" | "sending" | "sent" | "failed";

interface SignInFormProps {
  readonly linkError?: boolean;
}

export function SignInForm({ linkError = false }: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function requestMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");

    const supabase = createMagicLinkRequestClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
      },
    });

    setStatus(error ? "failed" : "sent");
  }

  return (
    <>
      {linkError && status === "idle" ? (
        <p className="auth-note auth-note--error" role="alert">
          That link was already used or has expired. Request a new one below —
          each link works once.
        </p>
      ) : null}

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
        <button disabled={status === "sending"} type="submit">
          {status === "sending" ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>

      {status === "sent" ? (
        <p className="auth-note auth-note--sent" aria-live="polite">
          Check your inbox. Open the newest email — requesting another link
          invalidates the previous one.
        </p>
      ) : null}

      {status === "failed" ? (
        <p className="auth-note auth-note--error" role="alert">
          We could not send a sign-in link. Please try again in a moment.
        </p>
      ) : null}
    </>
  );
}
