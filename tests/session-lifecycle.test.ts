import { describe, expect, it } from "vitest";

import {
  CONSECUTIVE_FAILURE_THRESHOLD,
  decideSessionLifecycle,
  type SessionCheckResult,
  type SessionLifecycleState,
} from "@/src/lib/riot/session-lifecycle";

const initialState: SessionLifecycleState = {
  consecutiveFailures: 0,
  status: "checking",
};

function applyResults(
  results: readonly SessionCheckResult[],
): SessionLifecycleState {
  return results.reduce(
    (state, result) => decideSessionLifecycle(state, result).nextState,
    initialState,
  );
}

describe("session lifecycle decisions", () => {
  it("resets the consecutive-failure counter after OK", () => {
    const decision = decideSessionLifecycle(
      { consecutiveFailures: 2, status: "checking" },
      "OK",
    );

    expect(decision).toEqual({
      nextState: { consecutiveFailures: 0, status: "checking" },
      shouldContinueChecks: true,
    });
  });

  it("disconnects immediately on DEAD without counting it", () => {
    const decision = decideSessionLifecycle(
      { consecutiveFailures: 2, status: "checking" },
      "DEAD",
    );

    expect(decision).toEqual({
      nextState: { consecutiveFailures: 2, status: "disconnected" },
      shouldContinueChecks: false,
    });
  });

  it.each(["UNKNOWN", "ERROR"] as const)(
    "counts %s without disconnecting below the threshold",
    (result) => {
      const decision = decideSessionLifecycle(initialState, result);

      expect(decision).toEqual({
        nextState: { consecutiveFailures: 1, status: "checking" },
        shouldContinueChecks: true,
      });
    },
  );

  it.each(["UNKNOWN", "ERROR"] as const)(
    "requires reauthentication when %s reaches three consecutive failures",
    (result) => {
      const decision = decideSessionLifecycle(
        {
          consecutiveFailures: CONSECUTIVE_FAILURE_THRESHOLD - 1,
          status: "checking",
        },
        result,
      );

      expect(decision).toEqual({
        nextState: {
          consecutiveFailures: CONSECUTIVE_FAILURE_THRESHOLD,
          status: "reauth-required",
        },
        shouldContinueChecks: false,
      });
    },
  );

  it("uses a greater-than-or-equal threshold when the stored count is already high", () => {
    const decision = decideSessionLifecycle(
      { consecutiveFailures: 3, status: "checking" },
      "ERROR",
    );

    expect(decision.nextState).toEqual({
      consecutiveFailures: 4,
      status: "reauth-required",
    });
  });

  it("does not accumulate one UNKNOWN between two OK results", () => {
    expect(applyResults(["OK", "UNKNOWN", "OK"])).toEqual({
      consecutiveFailures: 0,
      status: "checking",
    });

    expect(applyResults(["OK", "UNKNOWN", "OK", "ERROR"])).toEqual({
      consecutiveFailures: 1,
      status: "checking",
    });
  });

  it.each(["reauth-required", "disconnected"] as const)(
    "does not restart checks from the %s state",
    (status) => {
      const currentState = { consecutiveFailures: 3, status };
      const decision = decideSessionLifecycle(currentState, "OK");

      expect(decision.nextState).toBe(currentState);
      expect(decision.shouldContinueChecks).toBe(false);
    },
  );

  it("rejects an invalid persisted counter", () => {
    expect(() =>
      decideSessionLifecycle(
        { consecutiveFailures: -1, status: "checking" },
        "UNKNOWN",
      ),
    ).toThrow(RangeError);
  });
});
