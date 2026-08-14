export const CONSECUTIVE_FAILURE_THRESHOLD = 3;

export type SessionCheckResult = "OK" | "DEAD" | "UNKNOWN" | "ERROR";

export type SessionLifecycleStatus =
  | "checking"
  | "reauth-required"
  | "disconnected";

export type SessionLifecycleState = {
  readonly consecutiveFailures: number;
  readonly status: SessionLifecycleStatus;
};

export type SessionLifecycleDecision = {
  readonly nextState: SessionLifecycleState;
  readonly shouldContinueChecks: boolean;
};

function assertValidCounter(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      "Session lifecycle failure count must be a non-negative safe integer.",
    );
  }
}

/**
 * Pure lifecycle transition based on the authoritative three-failure rule.
 * External reconnect/disconnect operations, persistence, and notifications are
 * deliberately outside this decision boundary.
 */
export function decideSessionLifecycle(
  currentState: SessionLifecycleState,
  checkResult: SessionCheckResult,
): SessionLifecycleDecision {
  assertValidCounter(currentState.consecutiveFailures);

  if (checkResult === "DEAD") {
    return {
      nextState: {
        consecutiveFailures: currentState.consecutiveFailures,
        status: "disconnected",
      },
      shouldContinueChecks: false,
    };
  }

  if (currentState.status !== "checking") {
    return {
      nextState: currentState,
      shouldContinueChecks: false,
    };
  }

  if (checkResult === "OK") {
    return {
      nextState: { consecutiveFailures: 0, status: "checking" },
      shouldContinueChecks: true,
    };
  }

  const consecutiveFailures = currentState.consecutiveFailures + 1;
  if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
    return {
      nextState: { consecutiveFailures, status: "reauth-required" },
      shouldContinueChecks: false,
    };
  }

  return {
    nextState: { consecutiveFailures, status: "checking" },
    shouldContinueChecks: true,
  };
}
