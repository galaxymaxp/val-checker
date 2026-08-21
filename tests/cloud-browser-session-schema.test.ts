import { describe, expect, it } from "vitest";

import { cloudBrowserSessionSchema } from "@/cloud-browser/src/session-schema";

const input = {
  connectionSessionId: "b561ee24-0a90-4fd0-85d0-5ba8f19f1822",
  viewport: { height: 731, width: 813 },
};

describe("cloud browser session input", () => {
  it.each([
    "2026-08-21T11:11:53.167Z",
    "2026-08-21T11:11:53.167+00:00",
  ])("accepts ISO timestamps from JavaScript and Postgres: %s", (expiresAt) => {
    expect(
      cloudBrowserSessionSchema.safeParse({ ...input, expiresAt }).success,
    ).toBe(true);
  });

  it("still rejects a timestamp without a timezone", () => {
    expect(
      cloudBrowserSessionSchema.safeParse({
        ...input,
        expiresAt: "2026-08-21T11:11:53.167",
      }).success,
    ).toBe(false);
  });
});
