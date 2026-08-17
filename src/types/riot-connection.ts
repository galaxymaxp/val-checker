export type RiotConnectionState = "connected" | "disconnected";

export type ManualRefreshAvailability =
  | "available"
  | "in-progress"
  | "succeeded"
  | "exhausted"
  | "unavailable";

export type RiotSessionSubmission = {
  readonly connectionId?: string;
  readonly consentGranted: boolean;
  readonly label?: string;
  readonly region?: string;
  readonly serializedJar: string;
};

export type RiotConnectionMutationResult =
  | { readonly ok: true; readonly warning?: string }
  | { readonly error: string; readonly ok: false };

/**
 * Credential sign-in submission. The password crosses the wire to the server
 * action under TLS and is never stored, echoed back, or logged.
 */
export type RiotCredentialSubmission = {
  readonly connectionId?: string;
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
