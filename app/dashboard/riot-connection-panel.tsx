"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { RiotConnectTutorial } from "@/app/dashboard/riot-connect-tutorial";
import type {
  RiotCaptureTokenResult,
  RiotConnectionMutationResult,
  RiotConnectionState,
  RiotCredentialConnectResult,
  RiotCredentialSubmission,
  RiotMfaSubmission,
  RiotSessionSubmission,
} from "@/src/types/riot-connection";

interface RiotConnectionPanelProps {
  readonly cloudConnectAvailable?: boolean;
  readonly connectAllowed: boolean;
  /** Mints the one-time token handed directly to the browser extension. */
  readonly createCaptureToken?: () => Promise<RiotCaptureTokenResult>;
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

const WEB_MESSAGE_SOURCE = "val-checker-web";
const EXTENSION_MESSAGE_SOURCE = "val-checker-extension";

type ExtensionState = "checking" | "missing" | "ready";
const EXTENSION_REQUEST_TIMEOUT_MS = 5 * 60 * 1_000 + 5_000;

function extensionFailureMessage(reason: unknown): string {
  switch (reason) {
    case "cancelled":
      return "Riot sign-in was cancelled. Start again when you’re ready.";
    case "denied":
      return "Riot did not complete that sign-in. Please try again.";
    case "expired":
      return "Riot sign-in wasn’t detected. Try again or open How to connect.";
    case "capture-failed":
      return "Riot signed in, but no usable session was captured. Please try again.";
    case "open-failed":
      return "The Riot sign-in tab could not be opened. Check the extension and try again.";
    case "connect-failed":
      return "Riot signed in, but VAL Checker couldn’t save the account. Please try again.";
    default:
      return "The Riot session could not be connected. Please try again.";
  }
}

function RiotConnectionPanelState({
  cloudConnectAvailable = false,
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
  const [showJarPaste, setShowJarPaste] = useState(
    !cloudConnectAvailable &&
      !createCaptureToken &&
      !connectCredentials &&
      Boolean(connectSession),
  );
  const [isPending, setIsPending] = useState(false);
  const [isExtensionPending, setIsExtensionPending] = useState(false);
  const [extensionAttemptFailed, setExtensionAttemptFailed] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [extensionState, setExtensionState] = useState<ExtensionState>(
    createCaptureToken ? "checking" : "missing",
  );
  const activeExtensionRequest = useRef<string | null>(null);
  const extensionRequestTimer = useRef<number | null>(null);

  const hasConnectMethod =
    cloudConnectAvailable ||
    Boolean(createCaptureToken) ||
    Boolean(connectCredentials) ||
    Boolean(connectFixture) ||
    Boolean(connectSession);

  const connectionBadgeLabel = targetConnectionId
    ? connectionState === "connected"
      ? "Reconnected"
      : "Reconnect"
    : connectionState === "connected"
      ? "Connected"
      : "New account";

  const credentialsReady =
    username.trim().length > 0 && password.length > 0 && consentGranted;

  useEffect(() => {
    if (!createCaptureToken) {
      return;
    }

    const detectionTimer = window.setTimeout(() => {
      setExtensionState((current) =>
        current === "checking" ? "missing" : current,
      );
    }, 1_200);

    function onExtensionMessage(event: MessageEvent) {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.source !== EXTENSION_MESSAGE_SOURCE
      ) {
        return;
      }

      if (event.data.type === "VAL_CHECKER_EXTENSION_READY") {
        window.clearTimeout(detectionTimer);
        setExtensionState("ready");
        return;
      }

      if (
        event.data.type !== "VAL_CHECKER_RIOT_CONNECT_RESULT" ||
        event.data.requestId !== activeExtensionRequest.current
      ) {
        return;
      }

      activeExtensionRequest.current = null;
      if (extensionRequestTimer.current !== null) {
        window.clearTimeout(extensionRequestTimer.current);
        extensionRequestTimer.current = null;
      }
      setIsPending(false);
      setIsExtensionPending(false);
      if (event.data.ok !== true) {
        setExtensionAttemptFailed(true);
        setSuccess(undefined);
        setError(extensionFailureMessage(event.data.reason));
        return;
      }

      setExtensionAttemptFailed(false);
      setError(undefined);
      setConnectionState("connected");
      setSuccess(
        targetConnectionId
          ? "This Riot account was reconnected."
          : "Riot account connected.",
      );
      setConsentGranted(false);
      router.refresh();
    }

    window.addEventListener("message", onExtensionMessage);
    window.postMessage(
      { source: WEB_MESSAGE_SOURCE, type: "VAL_CHECKER_EXTENSION_PING" },
      window.location.origin,
    );

    return () => {
      window.clearTimeout(detectionTimer);
      if (extensionRequestTimer.current !== null) {
        window.clearTimeout(extensionRequestTimer.current);
      }
      window.removeEventListener("message", onExtensionMessage);
    };
  }, [createCaptureToken, router, targetConnectionId]);

  function startCloudConnect() {
    if (!cloudConnectAvailable || !consentGranted || isPending) return;
    const query = new URLSearchParams({ region });
    if (label.trim()) query.set("label", label.trim());
    if (targetConnectionId) query.set("connection", targetConnectionId);
    router.push(`/connect/riot?${query.toString()}`);
  }

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

  async function connectViaExtension() {
    if (
      !createCaptureToken ||
      extensionState !== "ready" ||
      !consentGranted ||
      isPending
    ) {
      return;
    }

    setIsPending(true);
    setIsExtensionPending(true);
    setExtensionAttemptFailed(false);
    setError(undefined);
    setSuccess(undefined);

    try {
      const result = await createCaptureToken();
      if (!result.ok) {
        setExtensionAttemptFailed(true);
        setError(result.error);
        setIsPending(false);
        setIsExtensionPending(false);
        return;
      }

      const requestId = crypto.randomUUID();
      activeExtensionRequest.current = requestId;
      extensionRequestTimer.current = window.setTimeout(() => {
        if (activeExtensionRequest.current !== requestId) return;
        activeExtensionRequest.current = null;
        extensionRequestTimer.current = null;
        setIsPending(false);
        setIsExtensionPending(false);
        setExtensionAttemptFailed(true);
        setError("Riot sign-in wasn’t detected. Try again or open How to connect.");
      }, EXTENSION_REQUEST_TIMEOUT_MS);

      window.postMessage(
        {
          payload: {
            connectionId: targetConnectionId,
            label: label.trim() || undefined,
            region,
            requestId,
            token: result.token,
          },
          source: WEB_MESSAGE_SOURCE,
          type: "VAL_CHECKER_RIOT_CONNECT_START",
        },
        window.location.origin,
      );
    } catch {
      setExtensionAttemptFailed(true);
      setError("The browser extension could not start Riot sign-in.");
      setIsPending(false);
      setIsExtensionPending(false);
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
          {connectionState === "disconnected" || keepConnectFormOpen ? (
            <p>Check your VALORANT store automatically.</p>
          ) : null}
        </div>
        <span className={`connection-badge connection-badge-${connectionState}`}>
          {connectionBadgeLabel}
        </span>
      </div>

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
            {createCaptureToken ? (
              <section
                aria-labelledby="extension-riot-connect-heading"
                className="riot-connect-method riot-connect-method-primary"
              >
                <div className="riot-connect-method-heading">
                  <div>
                    <p className="riot-connect-method-kicker">Recommended</p>
                    <h3 id="extension-riot-connect-heading">Sign in with Riot</h3>
                    <p>
                      Continue on Riot&apos;s website. Your password stays with Riot.
                    </p>
                  </div>
                  <span
                    className={`connection-badge connection-badge-${
                      extensionState === "ready" ? "connected" : "disconnected"
                    }`}
                  >
                    {extensionState === "ready"
                      ? "Extension ready"
                      : extensionState === "checking"
                        ? "Checking extension"
                        : "Extension needed"}
                  </span>
                </div>
                <div className="riot-signin-fields">
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
                </div>
                {isExtensionPending ? (
                  <div className="riot-connect-progress" role="status">
                    <span className="riot-connect-progress-title">
                      <span aria-hidden="true" className="riot-connect-spinner" />
                      Waiting for Riot sign-in…
                    </span>
                    <small>
                      Finish signing in on the Riot tab we opened. This page
                      will update automatically.
                    </small>
                  </div>
                ) : (
                  <button
                    className="riot-connect-primary-button"
                    disabled={
                      extensionState !== "ready" ||
                      !consentGranted ||
                      isPending
                    }
                    onClick={() => void connectViaExtension()}
                    type="button"
                  >
                    {extensionAttemptFailed ? "Try again" : "Sign in with Riot"}
                  </button>
                )}
                <label className="consent-check">
                  <input
                    checked={consentGranted}
                    onChange={(event) => setConsentGranted(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    I understand that VAL Checker stores an encrypted Riot session
                    so it can check this account&apos;s store.
                  </span>
                </label>
                <div className="riot-connect-help-row">
                  <RiotConnectTutorial />
                  {extensionState === "missing" ? (
                    <a
                      className="riot-connect-download-link"
                      download
                      href="/downloads/val-checker-riot-extension.zip"
                    >
                      Download &amp; Unzip Extension
                    </a>
                  ) : null}
                </div>
                {extensionState === "missing" ? (
                  <p className="riot-extension-note" role="note">
                    Extract the ZIP first. In Chrome or Edge, Load unpacked must
                    select the extracted folder containing manifest.json—not the
                    ZIP file.
                  </p>
                ) : null}
                <p role="note">
                  After sign-in, this page refreshes automatically.
                </p>
              </section>
            ) : cloudConnectAvailable ? (
              <section
                aria-labelledby="cloud-riot-connect-heading"
                className="riot-connect-method riot-connect-method-primary"
              >
                <div className="riot-connect-method-heading">
                  <div>
                    <p className="riot-connect-method-kicker">Recommended</p>
                    <h3 id="cloud-riot-connect-heading">Sign in with Riot</h3>
                    <p>
                      Complete Riot&apos;s real sign-in page in a temporary browser.
                      Nothing needs to be installed.
                    </p>
                  </div>
                </div>
                <div className="riot-signin-fields">
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
                </div>
                <button
                  className="riot-connect-primary-button"
                  disabled={!consentGranted || isPending}
                  onClick={startCloudConnect}
                  type="button"
                >
                  Sign in with Riot
                </button>
                <label className="consent-check">
                  <input
                    checked={consentGranted}
                    onChange={(event) => setConsentGranted(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    I understand that VAL Checker stores an encrypted Riot session
                    so it can check this account&apos;s store.
                  </span>
                </label>
                <p role="note">
                  Works on phones, tablets, and computers. Complete MFA or
                  CAPTCHA directly on Riot&apos;s page if Riot asks for it.
                </p>
              </section>
            ) : connectSession && !connectCredentials ? (
              <section
                aria-labelledby="cloud-riot-unavailable-heading"
                className="riot-connect-method riot-connect-method-unavailable"
                role="status"
              >
                <p className="riot-connect-method-kicker">Web sign-in</p>
                <h3 id="cloud-riot-unavailable-heading">
                  Sign in with Riot is temporarily unavailable
                </h3>
                <p>
                  The temporary Riot browser is not available right now. You can
                  still connect this account with cookie JSON below.
                </p>
              </section>
            ) : null}

            {connectAllowed && connectCredentials ? (
              <section
                aria-labelledby="credential-riot-connect-heading"
                className="riot-connect-method riot-connect-method-primary"
              >
                <div className="riot-connect-method-heading">
                  <div>
                    <p className="riot-connect-method-kicker">Private access</p>
                    <h3 id="credential-riot-connect-heading">
                      Sign in with Riot credentials
                    </h3>
                    <p>
                      Available only to explicitly allowlisted VAL Checker
                      accounts. Use your Riot login username, not your Riot ID
                      or email address.
                    </p>
                  </div>
                </div>
                <div
                  className={
                    createCaptureToken
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
                </div>
                <button
                  className="riot-connect-primary-button"
                  disabled={!credentialsReady || isPending}
                  onClick={signIn}
                  type="button"
                >
                  {isPending ? "Signing in to Riot..." : "Sign in to Riot"}
                </button>
                <label className="consent-check">
                  <input
                    checked={consentGranted}
                    onChange={(event) => setConsentGranted(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    I understand that VAL Checker stores an encrypted Riot session
                    so it can check this account&apos;s store.
                  </span>
                </label>
                <p className="ship-gate-note" role="note">
                  After connection, VAL Checker runs an initial store check.
                  Each Riot account then gets one automatic check and one
                  separate manual refresh per UTC day.
                </p>
              </section>
            ) : null}

            {connectAllowed && !connectCredentials && connectFixture ? (
              <div className="riot-fixture-connect">
                <button
                  disabled={!consentGranted || isPending}
                  onClick={connectFixtureSession}
                  type="button"
                >
                  {isPending ? "Connecting fixture..." : "Connect fixture session"}
                </button>
                <label className="consent-check">
                  <input
                    checked={consentGranted}
                    onChange={(event) => setConsentGranted(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    I understand that VAL Checker stores an encrypted Riot session
                    so it can check this account&apos;s store.
                  </span>
                </label>
              </div>
            ) : !connectAllowed && !cloudConnectAvailable ? (
              // Only a real state gets a control. An allowlisted account with
              // no wired form used to land on a disabled "not yet available"
              // button presented as the primary action.
              <button disabled type="button">
                Riot connection access not enabled
              </button>
            ) : null}

            {!connectAllowed && !cloudConnectAvailable ? (
              <p className="ship-gate-note" role="note">
                Riot connection access is limited to explicitly allowlisted
                accounts. Public VAL Checker signup and Riot-independent features
                remain available.
              </p>
            ) : null}

            {connectSession ? (
              <section
                aria-labelledby="cookie-json-connect-heading"
                className="riot-connect-method riot-session-connect"
                id="advanced-riot-connect"
              >
                <div className="riot-connect-method-heading">
                  <div>
                    <p className="riot-connect-method-kicker">
                      {cloudConnectAvailable ||
                      createCaptureToken ||
                      connectCredentials
                        ? "Advanced fallback"
                        : "Available now"}
                    </p>
                    <h3 id="cookie-json-connect-heading">Import cookie JSON</h3>
                    <p>
                      Use an exported <code>auth.riotgames.com</code> cookie file
                      when web sign-in is unavailable or gives you trouble.
                    </p>
                  </div>
                  <button
                    aria-controls="cookie-json-connect-form"
                    aria-expanded={showJarPaste}
                    className="riot-connect-method-toggle"
                    onClick={() => setShowJarPaste((shown) => !shown)}
                    type="button"
                  >
                    {showJarPaste ? "Hide JSON form" : "Use cookie JSON"}
                  </button>
                </div>
                {showJarPaste ? (
                  <div
                    className="riot-cookie-json-form"
                    id="cookie-json-connect-form"
                  >
                    <div className="consent-copy" role="note">
                      <p>
                        Sign in to Riot in your own browser, export the cookies
                        for <code>auth.riotgames.com</code> as JSON, then paste
                        the complete export below.
                      </p>
                      <p>
                        <strong>What you are pasting is a live session.</strong>{" "}
                        Anyone holding it can act as your Riot account until it
                        expires or you sign out everywhere. VAL Checker encrypts
                        it, uses it only for the daily store check, and deletes it
                        when you disconnect. Only paste it if you accept that.
                      </p>
                    </div>
                    <div className="riot-session-fields">
                      <label>
                        <span>Riot cookie JSON</span>
                        <textarea
                          autoComplete="off"
                          maxLength={128 * 1024}
                          onChange={(event) =>
                            setSerializedJar(event.target.value)
                          }
                          placeholder='Paste the complete JSON export, for example [{"name":"ssid",…}]'
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
                          : "Connect with cookie JSON"}
                      </button>
                      {!createCaptureToken &&
                      !cloudConnectAvailable &&
                      !connectCredentials ? (
                        <label className="consent-check">
                          <input
                            checked={consentGranted}
                            onChange={(event) =>
                              setConsentGranted(event.target.checked)
                            }
                            type="checkbox"
                          />
                          <span>
                            I understand that VAL Checker stores an encrypted Riot
                            session so it can check this account&apos;s store.
                          </span>
                        </label>
                      ) : null}
                      <p className="ship-gate-note" role="note">
                        VAL Checker contacts Riot to verify which account the
                        session belongs to and rotates it before encrypting. This
                        does not fetch your store.
                      </p>
                    </div>
                  </div>
                ) : null}
              </section>
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

      {hasConnectMethod ? (
        <details className="consent-details">
          <summary>How your Riot session is handled</summary>
          <div className="consent-copy">
            {createCaptureToken ? (
              <p>
                You sign in on Riot Games&apos; actual page in your normal browser.
                The extension cannot read your password, MFA code, CAPTCHA,
                keyboard, or mouse. After Riot accepts the sign-in, it sends the
                resulting session directly to VAL Checker without exposing it to
                this webpage.
              </p>
            ) : connectCredentials ? (
              <p>
                Your Riot username, password, and any MFA code are sent through
                VAL Checker&apos;s server directly to Riot for this sign-in. VAL
                Checker does not store or log them.
              </p>
            ) : cloudConnectAvailable ? (
              <p>
                You sign in on Riot Games&apos; actual login page inside a temporary,
                isolated browser. The remote-browser infrastructure carries your
                input while you interact with that page, but VAL Checker does not
                store your Riot password or MFA code.
              </p>
            ) : (
              <p>
                Cookie JSON connection does not ask for your Riot password. The
                exported cookie file is a live Riot session and must be protected
                like a password.
              </p>
            )}
            <p>
              After Riot accepts the sign-in or imported session, the complete
              renewable cookie jar is validated, encrypted, and stored.
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
        </details>
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
