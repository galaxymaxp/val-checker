export type RiotConnectionState = "connected" | "disconnected";

export type RiotSessionSubmission = {
  readonly consentGranted: boolean;
  readonly region?: string;
  readonly serializedJar: string;
};

export type RiotConnectionMutationResult =
  | { readonly ok: true }
  | { readonly error: string; readonly ok: false };
