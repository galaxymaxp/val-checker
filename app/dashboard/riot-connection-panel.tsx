"use client";

import { useState } from "react";

import type {
  RiotConnectionMutationResult,
  RiotConnectionState,
  RiotSessionSubmission,
} from "@/src/types/riot-connection";

interface RiotConnectionPanelProps {
  readonly connectAllowed: boolean;
  readonly connectFixture?: (
    consentGranted: boolean,
  ) => Promise<RiotConnectionMutationResult>;
  readonly connectSession?: (
    submission: RiotSessionSubmission,
  ) => Promise<RiotConnectionMutationResult>;
  readonly disconnect: () => Promise<RiotConnectionMutationResult>;
  readonly initialState: RiotConnectionState;
}

export function RiotConnectionPanel({
  connectAllowed,
  connectFixture,
  connectSession,
  disconnect,
  initialState,
}: RiotConnectionPanelProps) {
  const [connectionState, setConnectionState] =
    useState<RiotConnectionState>(initialState);
  const [consentGranted, setConsentGranted] = useState(false);
  const [region, setRegion] = useState("ap");
  const [serializedJar, setSerializedJar] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string>();

  async function connect() {
    if (
      !connectAllowed ||
      (!connectSession && !connectFixture) ||
      !consentGranted ||
      (connectSession && serializedJar.trim().length === 0) ||
      isPending
    ) {
      return;
    }

    setIsPending(true);
    setError(undefined);

    try {
      const result = connectSession
        ? await connectSession({ consentGranted, region, serializedJar })
        : await connectFixture!(consentGranted);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setConnectionState("connected");
    } catch {
      setError("The Riot session could not be connected.");
    } finally {
      if (connectSession) {
        setSerializedJar("");
      }
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
            {connectionState === "connected"
              ? connectSession
                ? "Riot connected"
                : "Fixture connected"
              : "Connection paused"}
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
          {connectAllowed && connectSession ? (
            <div className="riot-session-fields">
              <label>
                <span>Cookie export JSON</span>
                <textarea
                  autoComplete="off"
                  maxLength={128 * 1024}
                  onChange={(event) => setSerializedJar(event.target.value)}
                  placeholder="Paste the exported cookie JSON array"
                  rows={6}
                  spellCheck={false}
                  value={serializedJar}
                />
              </label>
              <label>
                <span>Account region</span>
                <select
                  onChange={(event) => setRegion(event.target.value)}
                  value={region}
                >
                  <option value="ap">Asia Pacific</option>
                  <option value="na">North America</option>
                  <option value="eu">Europe</option>
                  <option value="kr">Korea</option>
                </select>
              </label>
              <p className="ship-gate-note" role="note">
                Connection validates and encrypts this export without contacting Riot.
                Storefront access occurs only in the daily scheduled check.
              </p>
            </div>
          ) : null}

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
            disabled={
              !connectAllowed ||
              (!connectSession && !connectFixture) ||
              !consentGranted ||
              (Boolean(connectSession) && serializedJar.trim().length === 0) ||
              isPending
            }
            onClick={connect}
            type="button"
          >
            {!connectAllowed
              ? "Riot connection access not enabled"
              : connectSession
                ? isPending
                  ? "Connecting Riot session..."
                  : "Connect Riot session"
                : connectFixture
                  ? isPending
                    ? "Connecting fixture..."
                    : "Connect fixture session"
                  : "Riot connection not yet available"}
          </button>
          {!connectAllowed ? (
            <p className="ship-gate-note" role="note">
              Riot connection access is limited to explicitly allowlisted accounts.
              Public VAL Checker signup and Riot-independent features remain available.
            </p>
          ) : !connectSession && !connectFixture ? (
            <p className="ship-gate-note" role="note">
              Riot connection is not currently available for this account.
            </p>
          ) : null}
        </>
      ) : (
        <div className="disconnect-controls">
          <button disabled={isPending} onClick={disconnectSession} type="button">
            {isPending ? "Disconnecting..." : "Disconnect and delete stored session"}
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
