export type RiotConnectionState = "connected" | "disconnected";

export type RiotConnectionMutationResult =
  | { readonly ok: true }
  | { readonly error: string; readonly ok: false };
