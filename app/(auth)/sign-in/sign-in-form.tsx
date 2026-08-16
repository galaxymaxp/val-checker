"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { type FormEvent, useState } from "react";

import {
  createBrowserSupabaseClient,
  createMagicLinkRequestClient,
} from "@/src/lib/supabase/browser";

type Status = "idle" | "sending" | "sent" | "failed";

interface SignInFormProps {
  readonly linkError?: boolean;
}

const noteMotion = {
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  initial: { opacity: 0, y: 8 },
  transition: { duration: 0.25 },
} as const;

export function SignInForm({ linkError = false }: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [googlePending, setGooglePending] = useState(false);
  const [googleFailed, setGoogleFailed] = useState(false);

  async function continueWithGoogle() {
    setGooglePending(true);
    setGoogleFailed(false);

    // OAuth starts and finishes in this browser, so the PKCE verifier is always
    // present. That is why this path avoids the cross-browser failure that
    // emailed links hit.
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithOAuth({
      options: {
        redirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
      },
      provider: "google",
    });

    if (error) {
      setGooglePending(false);
      setGoogleFailed(true);
    }
  }

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
    <MotionConfig reducedMotion="user">
      {linkError && status === "idle" ? (
        <p
          className="rounded-card border border-line border-l-2 border-l-white/55 bg-white/5 px-4 py-3 text-sm text-ink"
          role="alert"
        >
          That link was already used or has expired. Each link works once —
          continue with Google below, or request a new link.
        </p>
      ) : null}

      <div className="flex flex-col gap-4 rounded-panel border border-line bg-bg-card p-6 shadow-panel">
        <button
          className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-card bg-white px-4 py-2.5 font-medium text-neutral-900! transition-transform hocus:-translate-y-0.5 disabled:cursor-progress disabled:opacity-70 disabled:hocus:translate-y-0"
          disabled={googlePending}
          onClick={continueWithGoogle}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 18 18" width="18" height="18">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
            />
            <path
              fill="#FBBC05"
              d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
            />
          </svg>
          {googlePending ? "Redirecting…" : "Continue with Google"}
        </button>

        <AnimatePresence mode="wait">
          {googleFailed ? (
            <motion.p
              {...noteMotion}
              className="rounded-card border border-line border-l-2 border-l-white/55 bg-white/5 px-4 py-3 text-sm text-ink"
              key="google-failed"
              role="alert"
            >
              Google sign-in is unavailable right now. Use an email link
              instead.
            </motion.p>
          ) : null}
        </AnimatePresence>

        <p className="flex items-center gap-3 text-xs uppercase tracking-widest text-ink-dim">
          <span aria-hidden="true" className="h-px flex-1 bg-line-soft" />
          or use email
          <span aria-hidden="true" className="h-px flex-1 bg-line-soft" />
        </p>

        <form className="flex flex-col gap-2" onSubmit={requestMagicLink}>
          <label className="text-sm font-medium text-ink-muted" htmlFor="email">
            Email address
          </label>
          <input
            autoComplete="email"
            className="w-full rounded-card border border-line bg-bg-inset px-3 py-2.5 text-ink outline-accent placeholder:text-ink-dim focus-visible:outline-2"
            id="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
          <button
            className="mt-1 cursor-pointer rounded-card bg-accent py-2.5 font-medium text-bg! hocus:bg-accent-hot disabled:cursor-progress disabled:opacity-60"
            disabled={status === "sending"}
            type="submit"
          >
            {status === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      </div>

      <AnimatePresence mode="wait">
        {status === "sent" ? (
          <motion.p
            {...noteMotion}
            aria-live="polite"
            className="rounded-card border border-line bg-white/5 px-4 py-3 text-sm text-ink"
            key="sent"
          >
            Check your inbox. Open the newest email — requesting another link
            invalidates the previous one.
          </motion.p>
        ) : null}

        {status === "failed" ? (
          <motion.p
            {...noteMotion}
            className="rounded-card border border-line border-l-2 border-l-white/55 bg-white/5 px-4 py-3 text-sm text-ink"
            key="failed"
            role="alert"
          >
            We could not send a sign-in link. Please try again in a moment.
          </motion.p>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  );
}
