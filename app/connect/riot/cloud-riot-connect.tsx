"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { RiotCloudConnectionState } from "@/src/types/database";

type SessionView = {
  readonly account?: {
    readonly gameName: string;
    readonly region: string;
    readonly tagLine: string;
  };
  readonly expiresAt: string;
  readonly failureCode: string | null;
  readonly id: string;
  readonly state: RiotCloudConnectionState;
  readonly streamUrl?: string;
};

const terminal = new Set<RiotCloudConnectionState>([
  "connected",
  "failed",
  "expired",
  "cancelled",
]);

export function CloudRiotConnect({
  connectionId,
  initialSessionId,
  label,
  region,
}: {
  readonly connectionId?: string;
  readonly initialSessionId?: string;
  readonly label?: string;
  readonly region?: string;
}) {
  const router = useRouter();
  const started = useRef(false);
  const [session, setSession] = useState<SessionView>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const start = async () => {
      try {
        const response = initialSessionId
          ? await fetch(`/api/riot/cloud/sessions/${initialSessionId}`, {
              cache: "no-store",
            })
          : await fetch("/api/riot/cloud/sessions", {
              body: JSON.stringify({
                connectionId,
                consentGranted: true,
                label,
                region: region ?? "ap",
                viewport: {
                  height: Math.max(568, Math.min(1200, window.innerHeight)),
                  width: Math.max(320, Math.min(1440, window.innerWidth)),
                },
              }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            });
        const value = (await response.json()) as SessionView & { error?: string };
        if (!response.ok) throw new Error(value.error);
        setSession(value);
        if (!initialSessionId) {
          router.replace(`/connect/riot/${value.id}`);
        }
      } catch (cause) {
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : "Riot connection is temporarily unavailable.",
        );
      }
    };
    void start();
  }, [connectionId, initialSessionId, label, region, router]);

  useEffect(() => {
    if (!session || terminal.has(session.state)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/riot/cloud/sessions/${session.id}`, {
          cache: "no-store",
        });
        const value = (await response.json()) as SessionView & { error?: string };
        if (!response.ok) throw new Error(value.error);
        setSession(value);
        if (value.state === "connected") router.refresh();
      } catch {
        setError("Riot connection is temporarily unavailable.");
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [router, session]);

  const cancel = async () => {
    if (session) {
      await fetch(`/api/riot/cloud/sessions/${session.id}`, { method: "DELETE" });
    }
    router.push("/dashboard/connection");
  };

  if (error) {
    return (
      <div className="flex flex-col gap-4" role="alert">
        <p>{error}</p>
        <button onClick={() => window.location.reload()} type="button">Try again</button>
        <Link href="/dashboard/connection#advanced-riot-connect">Import cookie JSON</Link>
      </div>
    );
  }

  if (!session) return <p role="status">Opening a secure temporary Riot session…</p>;

  if (session.state === "connected") {
    return (
      <div className="flex flex-col gap-4" role="status">
        <h2>✓ Connected</h2>
        {session.account ? (
          <p>
            {session.account.gameName}#{session.account.tagLine} · {session.account.region.toUpperCase()}
          </p>
        ) : null}
        <p>Your Riot account is connected. The temporary browser has been destroyed.</p>
        <Link href="/dashboard">Return to dashboard</Link>
      </div>
    );
  }
  if (session.state === "expired") {
    return <div role="alert"><p>This connection session expired.</p><Link href="/connect/riot">Start again</Link></div>;
  }
  if (session.state === "failed") {
    return <div role="alert"><p>Riot could not verify this login.</p><Link href="/connect/riot">Retry</Link></div>;
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <p role="status">You’re signing in on Riot Games’ actual login page inside a temporary, isolated browser. VAL Checker does not store your Riot password.</p>
      {session.streamUrl ? (
        <iframe
          allow="clipboard-read; clipboard-write"
          className="min-h-[70dvh] w-full rounded-xl border border-white/20 bg-black"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin"
          src={session.streamUrl}
          title="Temporary Riot sign-in browser"
        />
      ) : (
        <p>Starting the Riot browser…</p>
      )}
      <button onClick={cancel} type="button">Cancel and destroy browser</button>
    </div>
  );
}
