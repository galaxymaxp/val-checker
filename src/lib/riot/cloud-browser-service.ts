import "server-only";

import { z } from "zod";

export type CloudBrowserViewport = {
  readonly height: number;
  readonly width: number;
};

export type CloudBrowserStatus = {
  readonly captchaObserved: boolean;
  readonly mfaRequested: boolean;
  readonly state:
    | "starting"
    | "waiting_for_user"
    | "authenticating"
    | "captured"
    | "failed"
    | "expired";
};

export type CreatedCloudBrowserSession = CloudBrowserStatus & {
  readonly providerSessionId: string;
  readonly streamUrl: string;
};

export interface CloudBrowserService {
  createSession(input: {
    readonly connectionSessionId: string;
    readonly expiresAt: string;
    readonly viewport: CloudBrowserViewport;
  }): Promise<CreatedCloudBrowserSession>;
  getStatus(providerSessionId: string): Promise<CloudBrowserStatus>;
  getStream(providerSessionId: string): Promise<string>;
  captureCookies(providerSessionId: string): Promise<unknown>;
  destroySession(providerSessionId: string): Promise<void>;
}

const statusSchema = z.object({
  captchaObserved: z.boolean().default(false),
  mfaRequested: z.boolean().default(false),
  state: z.enum([
    "starting",
    "waiting_for_user",
    "authenticating",
    "captured",
    "failed",
    "expired",
  ]),
});

const createdSchema = statusSchema.extend({
  providerSessionId: z.string().min(16).max(200),
  streamUrl: z.url(),
});

const streamSchema = z.object({ streamUrl: z.url() });
const cookiesSchema = z.object({ cookies: z.array(z.unknown()).min(1).max(256) });

export class CloudBrowserConfigurationError extends Error {
  constructor() {
    super("Cloud browser service is not configured.");
    this.name = "CloudBrowserConfigurationError";
  }
}

export class CloudBrowserServiceError extends Error {
  constructor() {
    super("Cloud browser service is unavailable.");
    this.name = "CloudBrowserServiceError";
  }
}

export class HttpCloudBrowserService implements CloudBrowserService {
  private readonly baseUrl: URL;

  constructor(
    baseUrl = process.env.RIOT_CLOUD_BROWSER_URL,
    private readonly apiKey = process.env.RIOT_CLOUD_BROWSER_API_KEY,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    if (!baseUrl || !apiKey) {
      throw new CloudBrowserConfigurationError();
    }
    try {
      this.baseUrl = new URL(baseUrl);
    } catch {
      throw new CloudBrowserConfigurationError();
    }
    if (this.baseUrl.protocol !== "https:" && this.baseUrl.hostname !== "localhost") {
      throw new CloudBrowserConfigurationError();
    }
  }

  async createSession(input: {
    readonly connectionSessionId: string;
    readonly expiresAt: string;
    readonly viewport: CloudBrowserViewport;
  }): Promise<CreatedCloudBrowserSession> {
    const created = createdSchema.parse(
      await this.request("/v1/sessions", "POST", input),
    );
    this.assertStreamOrigin(created.streamUrl);
    return created;
  }

  async getStatus(providerSessionId: string): Promise<CloudBrowserStatus> {
    return statusSchema.parse(
      await this.request(`/v1/sessions/${encodeURIComponent(providerSessionId)}`, "GET"),
    );
  }

  async getStream(providerSessionId: string): Promise<string> {
    const result = streamSchema.parse(
      await this.request(
        `/v1/sessions/${encodeURIComponent(providerSessionId)}/stream`,
        "POST",
      ),
    );
    const stream = this.assertStreamOrigin(result.streamUrl);
    return stream.toString();
  }

  async captureCookies(providerSessionId: string): Promise<unknown> {
    return cookiesSchema.parse(
      await this.request(
        `/v1/sessions/${encodeURIComponent(providerSessionId)}/cookies`,
        "POST",
      ),
    ).cookies;
  }

  async destroySession(providerSessionId: string): Promise<void> {
    await this.request(
      `/v1/sessions/${encodeURIComponent(providerSessionId)}`,
      "DELETE",
    );
  }

  private async request(path: string, method: string, body?: unknown): Promise<unknown> {
    try {
      const response = await this.fetchImplementation(new URL(path, this.baseUrl), {
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        method,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new CloudBrowserServiceError();
      }
      if (response.status === 204) {
        return {};
      }
      return await response.json();
    } catch (error) {
      if (error instanceof CloudBrowserServiceError) {
        throw error;
      }
      throw new CloudBrowserServiceError();
    }
  }

  private assertStreamOrigin(value: string): URL {
    const stream = new URL(value);
    if (stream.origin !== this.baseUrl.origin) {
      throw new CloudBrowserServiceError();
    }
    return stream;
  }
}
