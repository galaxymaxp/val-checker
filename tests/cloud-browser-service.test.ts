import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CloudBrowserServiceError,
  CloudBrowserSessionNotFoundError,
  HttpCloudBrowserService,
} from "@/src/lib/riot/cloud-browser-service";

describe("HttpCloudBrowserService", () => {
  it("distinguishes a missing browser from transient provider overload", async () => {
    const missing = new HttpCloudBrowserService(
      "https://browser.example.test",
      "test-api-key",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const busy = new HttpCloudBrowserService(
      "https://browser.example.test",
      "test-api-key",
      vi.fn(async () => new Response(null, { status: 429 })),
    );

    await expect(missing.getStatus("provider-session-123456")).rejects.toBeInstanceOf(
      CloudBrowserSessionNotFoundError,
    );
    await expect(busy.getStatus("provider-session-123456")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CloudBrowserServiceError &&
        !(error instanceof CloudBrowserSessionNotFoundError),
    );
  });
});
