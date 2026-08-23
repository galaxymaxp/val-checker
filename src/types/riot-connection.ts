export type RiotConnectionState = "connected" | "disconnected";

export type RiotSessionSubmission = {
  readonly consentGranted: boolean;
  readonly region?: string;
  readonly serializedJar: string;
};

export type RiotConnectionMutationResult =
  | { readonly ok: true }
  | { readonly error: string; readonly ok: false };

/**
 * Credential sign-in submission. The password crosses the wire to the server
 * action under TLS and is never stored, echoed back, or logged.
 */
export type RiotCredentialSubmission = {
  readonly consentGranted: boolean;
  readonly label?: string;
  readonly password: string;
  readonly region?: string;
  readonly username: string;
};

export type RiotMfaSubmission = {
  readonly code: string;
};

/**
 * Result of minting a one-time desktop capture token. The token is a bearer
 * credential: it is returned to the signed-in browser exactly once so it can
 * be placed in the valchecker:// deep link, and only its hash is stored.
 */
export type RiotDesktopCaptureTokenResult =
  | { readonly ok: true; readonly token: string }
  | { readonly error: string; readonly ok: false };

/**
 * Either the connection completed, or Riot issued an MFA challenge and the UI
 * must collect a code. `maskedTarget` is Riot's own masked hint, safe to show.
 */
export type RiotCredentialConnectResult =
  | { readonly ok: true; readonly status: "connected" }
  | {
      readonly maskedTarget: string | null;
      readonly method: string | null;
      readonly ok: true;
      readonly status: "multifactor-required";
    }
  | { readonly error: string; readonly ok: false };
