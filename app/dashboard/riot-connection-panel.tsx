"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import type { RiotDesktopCaptureResult } from "@/src/types/desktop-bridge";
import type {
  RiotConnectionMutationResult,
  RiotConnectionState,
  RiotDesktopCaptureTokenResult,
  RiotCredentialConnectResult,
  RiotCredentialSubmission,
  RiotMfaSubmission,
  RiotSessionSubmission,
} from "@/src/types/riot-connection";

interface RiotConnectionPanelProps {
  readonly connectAllowed: boolean;
  /** Mints the one-time token behind the valchecker:// deep link. */
  readonly createCaptureToken?: () => Promise<RiotDesktopCaptureTokenResult>;
  readonly connectCredentials?: (
    submission: RiotCredentialSubmission,
  ) => Promise<RiotCredentialConnectResult>;
  readonly connectFixture?: (
    consentGranted: boolean,
  ) => Promise<RiotConnectionMutationResult>;
  /** Session paste. Undefined when the connect allowlist excludes the user. */
  readonly connectSession?: (
    submission: RiotSessionSubmission,
  ) => Promise<RiotConnectionMutationResult>;
  readonly disconnect?: () => Promise<RiotConnectionMutationResult>;
  readonly initialLabel?: string;
  readonly initialRegion?: string;
  readonly initialState: RiotConnectionState;
  readonly keepConnectFormOpen?: boolean;
  readonly submitMfaCode?: (
    submission: RiotMfaSubmission,
  ) => Promise<RiotCredentialConnectResult>;
  /** Existing owned connection to replace during an isolated reconnect. */
  readonly targetConnectionId?: string;
}

type MfaChallenge = {
  readonly maskedTarget: string | null;
  readonly method: string | null;
};

// The desktop bridge is injected once, before the app loads, and never changes
// for the life of the window, so there is nothing to subscribe to.
function subscribeToDesktopBridge(): () => void {
  return () => {};
}

function getDesktopBridgeSnapshot(): boolean {
  return window.valChecker?.isDesktop === true;
}

function getDesktopBridgeServerSnapshot(): boolean {
  return false;
}

function RiotConnectionPanelState({
  connectAllowed,
  connectCredentials,
  connectFixture,
  connectSession,
  createCaptureToken,
  disconnect,
  initialLabel = "",
  initialRegion = "ap",
  initialState,
  keepConnectFormOpen = false,
  submitMfaCode,
  targetConnectionId,
}: RiotConnectionPanelProps) {
  const router = useRouter();
  const [connectionState, setConnectionState] =
    useState<RiotConnectionState>(initialState);
  const [consentGranted, setConsentGranted] = useState(false);
  const [region, setRegion] = useState(initialRegion);
  const [label, setLabel] = useState(initialLabel);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge>();
  const [mfaCode, setMfaCode] = useState("");
  const [serializedJar, setSerializedJar] = useState("");
  const [showJarPaste, setShowJarPaste] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  // Detect the Electron desktop shell without breaking SSR or hydration. The
  // server snapshot is always false, so the server-rendered HTML never contains
  // the desktop button; after hydration React reconciles to the client snapshot.
  // window is only touched in the client snapshot, which never runs during SSR
  // (and stays undefined in jsdom, so the button does not render under test).


  const isDesktop = useSyncExternalStore(
    subscribeToDesktopBridge,
    getDesktopBridgeSnapshot,
    getDesktopBridgeServerSnapshot,
  );

  const desktopConnectAvailable =
    (isDesktop || Boolean(createCaptureToken)) && Boolean(connectSession);

  const credentialsReady =
    username.trim().length > 0 && password.length > 0 && consentGranted;

  function applyResult(result: RiotCredentialConnectResult) {
    if (!result.ok) {
      setSuccess(undefined);
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
    setSuccess(
      targetConnectionId
        ? "This Riot account was reconnected."
        : "Riot account connected. You can add another whenever you’re ready.",
    );
    if (!targetConnectionId) {
      setConsentGranted(false);
      setLabel("");
      setUsername("");
    }
    router.refresh();
  }

  async function signIn() {
    if (!connectAllowed || !connectCredentials || !credentialsReady || isPending) {
      return;
    }

    setIsPending(true);
    setError(undefined);
    setSuccess(undefined);

    try {
      applyResult(
        await connectCredentials({
          connectionId: targetConnectionId,
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
    setSuccess(undefined);

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
    if (
      !connectSession ||
      serializedJar.trim().length === 0 ||
      !consentGranted ||
      isPending
    ) {
      return;
    }

    setIsPending(true);
    setError(undefined);
    setSuccess(undefined);

    try {
      const result = await connectSession({
        connectionId: targetConnectionId,
        consentGranted,
        label: label.trim() || undefined,
        region,
        serializedJar,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setConnectionState("connected");
      setSuccess(
        targetConnectionId
          ? "This Riot account was reconnected."
          : "Riot account connected. You can add another whenever you’re ready.",
      );
      router.refresh();
    } catch {
      setError("The Riot session could not be connected.");
    } finally {
      setSerializedJar("");
      setIsPending(false);
    }
  }

  function desktopCaptureError(
    result: Extract<RiotDesktopCaptureResult, { ok: false }>,
  ): string {
    switch (result.reason) {
      case "cancelled":
        return "Riot sign-in was cancelled.";
      case "timeout":
        return "The Riot sign-in window timed out. Please try again.";
      default:
        return "No Riot session was captured. Please complete the Riot sign-in.";
    }
  }

  /**
   * Hands off to the desktop app through the protocol link. Used when the page
   * is running in an ordinary browser, where there is no desktop bridge; the
   * app captures the session and posts it back itself.
   */
  async function connectViaDeepLink() {
    if (!createCaptureToken) {
      return;
    }

    setIsPending(true);
    setError(undefined);
    setSuccess(undefined);

    try {
      const result = await createCaptureToken();
      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Every browser tested refuses to hand a custom protocol URL to the OS
      // ("unknown protocol"), but plain loopback HTTP is always allowed. The
      // desktop app must already be running to answer; it cannot be launched
      // from a page.
      let handoff: Response;
      try {
        handoff = await fetch("http://127.0.0.1:47821/capture", {
          body: JSON.stringify({ token: result.token }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
      } catch {
        setError(
          "The desktop app is not running. Start it with `pnpm desktop:serve`, then try again.",
        );
        return;
      }

      const outcome: unknown = await handoff.json().catch(() => null);
      const ok =
        typeof outcome === "object" &&
        outcome !== null &&
        (outcome as { ok?: unknown }).ok === true;

      if (ok) {
        setSuccess("Riot account connected.");
        router.refresh();
        return;
      }

      setError(
        "Riot sign-in did not complete. Check the desktop window and try again.",
      );
    } catch {
      setError("The desktop sign-in could not be started.");
    } finally {
      setIsPending(false);
    }
  }

  async function connectViaDesktop() {
    const bridge = window.valChecker;
    if (!bridge || !connectSession || !consentGranted || isPending) {
      return;
    }

    setIsPending(true);
    setError(undefined);
    setSuccess(undefined);

    try {
      const capture = await bridge.connectRiot();
      if (!capture.ok) {
        setError(desktopCaptureError(capture));
        return;
      }

      const result = await connectSession({
        connectionId: targetConnectionId,
        consentGranted: true,
        label: label.trim() || undefined,
        region,
        serializedJar: capture.jar,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setConnectionState("connected");
      setSuccess(
        targetConnectionId
          ? "This Riot account was reconnected."
          : "Riot account connected. You can add another whenever you’re ready.",
      );
      router.refresh();
    } catch {
      setError("The Riot session could not be connected.");
    } finally {
      setIsPending(false);
    }
  }

  async function connectFixtureSession() {
    if (!connectFixture || !consentGranted || isPending) {
      return;
    }

    setIsPending(true);
    setError(undefined);
    setSuccess(undefined);

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
    if (!disconnect || isPending) {
      return;
    }

    setIsPending(true);
    setError(undefined);
    setSuccess(undefined);

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
    <section
      aria-labelledby="riot-connection-heading"
      className="riot-connection-panel"
      id="connect-riot-account"
    >
      <div className="riot-connection-heading">
        <div>
          <h2 id="riot-connection-heading">
            {targetConnectionId
              ? connectionState === "connected"
                ? "Riot account reconnected"
                : "Reconnect this Riot account"
              : keepConnectFormOpen
                ? "Connect another Riot account"
                : connectionState === "connected"
                  ? connectCredentials || connectSession
                    ? "Riot connected"
                    : "Fixture connected"
                  : "Connect a Riot account"}
          </h2>
        </div>
        <span className={`connection-badge connection-badge-${connectionState}`}>
          {connectionState}
        </span>
      </div>

      <details
        className="consent-details"
        // Open while disconnected (consent copy matters before connecting);
        // collapsed once connected so it stops dominating the screen.
        {...(connectionState === "disconnected" ? { open: true } : {})}
      >
        <summary>How your Riot credentials are handled</summary>
        <div className="consent-copy">
          <p>
            VAL Checker signs in to Riot on your behalf and stores the
            resulting session so it can run one automatic storefront check per
            UTC day. You may also request one separate manual refresh per UTC
            day.
          </p>
          <p>
            Your password is used only to complete that sign-in. It is never
            stored, never written to our logs, and is discarded as soon as Riot
            answers.
          </p>
          <p>
            The session we keep can permit access to your Riot account. It is
            encrypted at rest, and you can disconnect and delete it at any
            time.
          </p>
          <p>
            VAL Checker is not affiliated with Riot Games. To invalidate
            existing sessions outside VAL Checker, use Riot&apos;s
            <strong> Sign out everywhere</strong> option in your account
            security settings.
          </p>
        </div>
      </details>

      {connectionState === "disconnected" || keepConnectFormOpen ? (
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
            {desktopConnectAvailable ? (
              <div className="riot-desktop-connect">
                <button
                  className="riot-desktop-connect-button"
                  disabled={!consentGranted || isPending}
                  onClick={() => {
                    void (isDesktop ? connectViaDesktop() : connectViaDeepLink());
                  }}
                  type="button"
                >
                  {isPending
                    ? "Opening Riot sign-in..."
                    : "Sign in to Riot (desktop)"}
                </button>
                <p role="note">
                  Opens Riot&apos;s own sign-in window and hands the session
                  back automatically. Requires the desktop app to be running
                  (<code>pnpm desktop:serve</code>).
                </p>

              </div>
            ) : null}

            {connectAllowed && connectCredentials ? (
              <div
                className={
                  desktopConnectAvailable
                    ? "riot-signin-fields riot-signin-fields-deemphasized"
                    : "riot-signin-fields"
                }
              >
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
                  Signing in does not fetch your shop. Each Riot account gets
                  one automatic check and one separate manual refresh per UTC
                  day.
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
            ) : !connectAllowed ? (
              // Only a real state gets a control. An allowlisted account with
              // no wired form used to land on a disabled "not yet available"
              // button presented as the primary action.
              <button disabled type="button">
                Riot connection access not enabled
              </button>
            ) : null}

            {!connectAllowed ? (
              <p className="ship-gate-note" role="note">
                Riot connection access is limited to explicitly allowlisted
                accounts. Public VAL Checker signup and Riot-independent features
                remain available.
              </p>
            ) : null}

            {connectSession ? (
              <div className="riot-session-connect">
                <button
                  aria-expanded={showJarPaste}
                  onClick={() => setShowJarPaste((shown) => !shown)}
                  type="button"
                >
                  {showJarPaste
                    ? "Hide session paste"
                    : "Connect with an exported session"}
                </button>
                {showJarPaste ? (
                  <div className="consent-copy" role="note">
                    <p>
                      Sign in to Riot in your browser, then export your
                      cookies for <code>auth.riotgames.com</code> as JSON with
                      a cookie-export extension and paste the result below. The
                      <code> ssid</code> cookie is the one that matters.
                    </p>
                    <p>
                      <strong>What you are pasting is a live session.</strong>{" "}
                      Anyone holding it can act as your Riot account until it
                      expires or you sign out everywhere. VAL Checker encrypts
                      it, uses it only for the daily store check, and deletes it
                      when you disconnect. Only paste it if you accept that.
                    </p>
                  </div>
                ) : null}
                {showJarPaste ? (
                  <div className="riot-session-fields">
                    <label>
                      <span>Captured Riot session</span>
                      <textarea
                        autoComplete="off"
                        maxLength={128 * 1024}
                        onChange={(event) =>
                          setSerializedJar(event.target.value)
                        }
                        placeholder="Paste the captured session here"
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
                      VAL Checker contacts Riot to verify which account the
                      session belongs to and rotates it before encrypting. This
                      does not fetch your store.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )
      ) : disconnect ? (
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
      ) : null}

      {success ? (
        <p
          className="rounded-card border border-white/20 bg-white/5 px-4 py-3 text-sm"
          role="status"
        >
          {success}
        </p>
      ) : null}

      {error ? (
        <p className="connection-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Re-key the stateful form when navigation selects another reconnect target.
 * This prevents labels, MFA challenges, consent, and result messages from one
 * Riot account carrying into another account's reconnect flow.
 */
export function RiotConnectionPanel(props: RiotConnectionPanelProps) {
  return (
    <RiotConnectionPanelState
      key={props.targetConnectionId ?? "new-riot-account"}
      {...props}
    />
  );
}
