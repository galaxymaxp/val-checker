"use client";

import { useState } from "react";

import type {
  RiotConnectionMutationResult,
  RiotConnectionState,
  RiotCredentialConnectResult,
  RiotCredentialSubmission,
  RiotMfaSubmission,
  RiotSessionSubmission,
} from "@/src/types/riot-connection";

interface RiotConnectionPanelProps {
  readonly connectAllowed: boolean;
  readonly connectCredentials?: (
    submission: RiotCredentialSubmission,
  ) => Promise<RiotCredentialConnectResult>;
  readonly connectFixture?: (
    consentGranted: boolean,
  ) => Promise<RiotConnectionMutationResult>;
  /** Admin-only cookie-jar fallback. Undefined for ordinary users. */
  readonly connectSession?: (
    submission: RiotSessionSubmission,
  ) => Promise<RiotConnectionMutationResult>;
  readonly disconnect: () => Promise<RiotConnectionMutationResult>;
  readonly initialState: RiotConnectionState;
  readonly submitMfaCode?: (
    submission: RiotMfaSubmission,
  ) => Promise<RiotCredentialConnectResult>;
}

type MfaChallenge = {
  readonly maskedTarget: string | null;
  readonly method: string | null;
};

export function RiotConnectionPanel({
  connectAllowed,
  connectCredentials,
  connectFixture,
  connectSession,
  disconnect,
  initialState,
  submitMfaCode,
}: RiotConnectionPanelProps) {
  const [connectionState, setConnectionState] =
    useState<RiotConnectionState>(initialState);
  const [consentGranted, setConsentGranted] = useState(false);
  const [region, setRegion] = useState("ap");
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge>();
  const [mfaCode, setMfaCode] = useState("");
  const [serializedJar, setSerializedJar] = useState("");
  const [showJarPaste, setShowJarPaste] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string>();

  const credentialsReady =
    username.trim().length > 0 && password.length > 0 && consentGranted;

  function applyResult(result: RiotCredentialConnectResult) {
    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (result.status === "multifactor-required") {
      setMfaChallenge({
        maskedTarget: result.maskedTarget,
        method: result.method,
      });
      return;
    }

    setMfaChallenge(undefined);
    setConnectionState("connected");
  }

  async function signIn() {
    if (!connectAllowed || !connectCredentials || !credentialsReady || isPending) {
      return;
    }

    setIsPending(true);
    setError(undefined);

    try {
      applyResult(
        await connectCredentials({
          consentGranted,
          label: label.trim() || undefined,
          password,
          region,
          username: username.trim(),
        }),
      );
    } catch {
      setError("The Riot sign-in could not be completed.");
    } finally {
      // The password is dropped on every outcome, success or failure, so it
      // never lingers in component state after the request that used it.
      setPassword("");
      setIsPending(false);
    }
  }

  async function verifyCode() {
    if (!submitMfaCode || mfaCode.trim().length === 0 || isPending) {
      return;
    }

    setIsPending(true);
    setError(undefined);

    try {
      applyResult(await submitMfaCode({ code: mfaCode.trim() }));
    } catch {
      setError("The verification code could not be checked.");
    } finally {
      setMfaCode("");
      setIsPending(false);
    }
  }

  function cancelMfa() {
    setMfaChallenge(undefined);
    setMfaCode("");
    setError(undefined);
  }

  async function connectJar() {
    if (!connectSession || serializedJar.trim().length === 0 || !consentGranted) {
      return;
    }

    setIsPending(true);
    setError(undefined);

    try {
      const result = await connectSession({
        consentGranted,
        region,
        serializedJar,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setConnectionState("connected");
    } catch {
      setError("The Riot session could not be connected.");
    } finally {
      setSerializedJar("");
      setIsPending(false);
    }
  }

  async function connectFixtureSession() {
    if (!connectFixture || !consentGranted || isPending) {
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
      setError("The Riot session could not be connected.");
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
            {connectionState === "connected"
              ? connectCredentials || connectSession
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
          VAL Checker signs in to Riot on your behalf and stores the resulting
          session so it can check your shop once a day.
        </p>
        <p>
          Your password is used only to complete that sign-in. It is never
          stored, never written to our logs, and is discarded as soon as Riot
          answers.
        </p>
        <p>
          The session we keep can permit access to your Riot account. It is
          encrypted at rest, and you can disconnect and delete it at any time.
        </p>
        <p>
          VAL Checker is not affiliated with Riot Games. To invalidate existing
          sessions outside VAL Checker, use Riot&apos;s
          <strong> Sign out everywhere</strong> option in your account security
          settings.
        </p>
      </div>

      {connectionState === "disconnected" ? (
        mfaChallenge ? (
          <div className="riot-mfa-fields">
            <p role="status">
              Riot sent a verification code
              {mfaChallenge.maskedTarget
                ? ` to ${mfaChallenge.maskedTarget}`
                : ""}
              . Enter it to finish connecting.
            </p>
            <label>
              <span>Verification code</span>
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setMfaCode(event.target.value)}
                pattern="[0-9]{6}"
                value={mfaCode}
              />
            </label>
            <button
              disabled={mfaCode.trim().length === 0 || isPending}
              onClick={verifyCode}
              type="button"
            >
              {isPending ? "Verifying..." : "Verify and connect"}
            </button>
            <button disabled={isPending} onClick={cancelMfa} type="button">
              Start over
            </button>
          </div>
        ) : (
          <>
            {connectAllowed && connectCredentials ? (
              <div className="riot-signin-fields">
                <label>
                  <span>Riot username</span>
                  <input
                    autoComplete="username"
                    onChange={(event) => setUsername(event.target.value)}
                    spellCheck={false}
                    value={username}
                  />
                </label>
                <label>
                  <span>Riot password</span>
                  <input
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    value={password}
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
                <label>
                  <span>Account name (optional)</span>
                  <input
                    maxLength={60}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Tells this account apart from your others"
                    value={label}
                  />
                </label>
                <p className="ship-gate-note" role="note">
                  Signing in does not fetch your shop. Storefront access still
                  happens once per account per day.
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
                I understand what Riot session material can permit and consent to
                encrypted storage for this connection.
              </span>
            </label>

            {connectAllowed && connectCredentials ? (
              <button
                disabled={!credentialsReady || isPending}
                onClick={signIn}
                type="button"
              >
                {isPending ? "Signing in to Riot..." : "Sign in to Riot"}
              </button>
            ) : connectAllowed && connectFixture ? (
              <button
                disabled={!consentGranted || isPending}
                onClick={connectFixtureSession}
                type="button"
              >
                {isPending ? "Connecting fixture..." : "Connect fixture session"}
              </button>
            ) : (
              <button disabled type="button">
                {connectAllowed
                  ? "Riot connection not yet available"
                  : "Riot connection access not enabled"}
              </button>
            )}

            {!connectAllowed ? (
              <p className="ship-gate-note" role="note">
                Riot connection access is limited to explicitly allowlisted
                accounts. Public VAL Checker signup and Riot-independent features
                remain available.
              </p>
            ) : !connectCredentials && !connectFixture ? (
              <p className="ship-gate-note" role="note">
                Riot connection is not currently available for this account.
              </p>
            ) : null}

            {connectSession ? (
              <div className="riot-admin-fallback">
                <button
                  onClick={() => setShowJarPaste((shown) => !shown)}
                  type="button"
                >
                  {showJarPaste
                    ? "Hide cookie export fallback"
                    : "Use cookie export instead (admin)"}
                </button>
                {showJarPaste ? (
                  <div className="riot-session-fields">
                    <label>
                      <span>Cookie export JSON</span>
                      <textarea
                        autoComplete="off"
                        maxLength={128 * 1024}
                        onChange={(event) =>
                          setSerializedJar(event.target.value)
                        }
                        placeholder="Paste the exported cookie JSON array"
                        rows={6}
                        spellCheck={false}
                        value={serializedJar}
                      />
                    </label>
                    <button
                      disabled={
                        serializedJar.trim().length === 0 ||
                        !consentGranted ||
                        isPending
                      }
                      onClick={connectJar}
                      type="button"
                    >
                      {isPending
                        ? "Connecting Riot session..."
                        : "Connect from cookie export"}
                    </button>
                    <p className="ship-gate-note" role="note">
                      Fallback for when Riot&apos;s sign-in endpoint refuses
                      requests from the server. Validates and encrypts the export
                      without contacting Riot.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )
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
