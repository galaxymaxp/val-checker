export type RiotAuthCallbackOutcome = "completed" | "denied" | null;

export function classifyRiotAuthCallback(
  url: unknown,
): RiotAuthCallbackOutcome;
