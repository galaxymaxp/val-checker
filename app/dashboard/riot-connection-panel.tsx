"use client";

import { useState } from "react";

import type {
  RiotConnectionMutationResult,
  RiotConnectionState,
} from "@/src/types/riot-connection";

interface RiotConnectionPanelProps {
  readonly connectAllowed: boolean;
  readonly connectFixture?: (
    consentGranted: boolean,
  ) => Promise<RiotConnectionMutationResult>;
  readonly disconnect: () => Promise<RiotConnectionMutationResult>;
  readonly initialState: RiotConnectionState;
}

export function RiotConnectionPanel({
  connectAllowed,
  connectFixture,
  disconnect,
  initialState,
}: RiotConnectionPanelProps) {
  const [connectionState, setConnectionState] =
    useState<RiotConnectionState>(initialState);
  const [consentGranted, setConsentGranted] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string>();

  async function connect() {
    if (!connectAllowed || !connectFixture || !consentGranted || isPending) {
      return;
    }

    setIsPending(true);
    setError(undefined);

    try {
      const result = await connectFixture(consentGranted);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setConnectionState("connected");
    } catch {
      setError("The fixture Riot session could not be connected.");
    } finally {
      setIsPending(false);
    }
  }

  async function disconnectSession() {
    if (isPending) {
      return;
    }

    setIsPending(true);
    setError(undefined);

    try {
      const result = await disconnect();
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setConnectionState("disconnected");
      setConsentGranted(false);
    } catch {
      setError("The Riot session could not be disconnected.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <section aria-labelledby="riot-connection-heading" className="riot-connection-panel">
      <div className="riot-connection-heading">
        <div>
          <p className="eyebrow">RIOT CONNECTION</p>
          <h2 id="riot-connection-heading">
            {connectionState === "connected" ? "Fixture connected" : "Connection paused"}
          </h2>
        </div>
        <span className={`connection-badge connection-badge-${connectionState}`}>
          {connectionState}
        </span>
      </div>

      <div className="consent-copy">
        <p>
          VAL Checker stores Riot cookie and session account-access material so it can
          perform Riot-dependent checks while that material remains valid.
        </p>
        <p>
          Valid session material can permit access to your Riot account. It is encrypted
          at rest, and you can disconnect and delete it at any time.
        </p>
        <p>
          To invalidate existing Riot sessions outside VAL Checker, use Riot&apos;s
          <strong> Sign out everywhere</strong> option in Riot account security settings.
        </p>
      </div>

      {connectionState === "disconnected" ? (
        <>
          <label className="consent-check">
            <input
              checked={consentGranted}
              onChange={(event) => setConsentGranted(event.target.checked)}
              type="checkbox"
            />
            <span>
              I understand what Riot session material can permit and consent to encrypted
              storage for this connection.
            </span>
          </label>
          <button
            disabled={!connectAllowed || !connectFixture || !consentGranted || isPending}
            onClick={connect}
            type="button"
          >
            {!connectAllowed
              ? "Riot connection access not enabled"
              : connectFixture
                ? isPending
                  ? "Connecting fixture…"
                  : "Connect fixture session"
                : "Riot connection not yet available"}
          </button>
          {!connectAllowed ? (
            <p className="ship-gate-note" role="note">
              Riot connection access is limited to explicitly allowlisted accounts.
              Public VAL Checker signup and Riot-independent features remain available.
            </p>
          ) : !connectFixture ? (
            <p className="ship-gate-note" role="note">
              The ship gate is closed. This site does not accept real Riot credentials or
              session material; connection remains fixture-only during development.
            </p>
          ) : null}
        </>
      ) : (
        <div className="disconnect-controls">
          <button disabled={isPending} onClick={disconnectSession} type="button">
            {isPending ? "Disconnecting…" : "Disconnect and delete stored session"}
          </button>
          <p>
            Disconnecting deletes VAL Checker&apos;s stored copy. Use Riot&apos;s
            <strong> Sign out everywhere</strong> option if you also want Riot to
            invalidate existing sessions.
          </p>
        </div>
      )}

      {error ? (
        <p className="connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
