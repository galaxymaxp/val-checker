export type RiotSessionLifecycleState =
  | { readonly connection: "connected" }
  | {
      readonly connection: "disconnected";
      readonly reason: "session-expired" | "user-disconnected";
    };

export type RenderedEmail = {
  readonly html: string;
  readonly subject: string;
};

export function renderSessionExpiredEmail(
  state: RiotSessionLifecycleState,
): RenderedEmail | null {
  if (
    state.connection !== "disconnected" ||
    state.reason !== "session-expired"
  ) {
    return null;
  }

  return {
    subject: "Your Riot session expired",
    html: [
      "<!doctype html>",
      '<html lang="en">',
      "<body>",
      "<h1>Your Riot session expired</h1>",
      "<p>Reconnect your Riot account so VAL Checker can resume Riot-dependent checks.</p>",
      "<p>VAL Checker is not affiliated with Riot Games.</p>",
      "</body>",
      "</html>",
    ].join(""),
  };
}
