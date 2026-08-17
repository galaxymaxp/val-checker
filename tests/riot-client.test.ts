import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  classifyReauthLocation,
  RIOT_CLIENT_PLATFORM,
  RiotClient,
  RiotClientError,
  RIOT_USER_AGENT,
} from "@/src/lib/riot/client";
import type { CapturedSession } from "@/src/lib/riot/session-provider";

vi.mock("server-only", () => ({}));

const ACCESS_TOKEN = "offline-access-value";
const ENTITLEMENTS_TOKEN = "offline-entitlements-value";
const PUUID = "11111111-2222-3333-4444-555555555555";
const CLIENT_VERSION = "release-offline-shipping-1";
const REAUTH_URL =
  "https://auth.riotgames.com/authorize" +
  "?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in" +
  "&client_id=play-valorant-web-prod" +
  "&response_type=token%20id_token&nonce=1&scope=account%20openid";

const storefrontFixture: unknown = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "fixtures", "storefront-real.json"),
    "utf8",
  ),
);

function sessionWithCookies(
  cookies: readonly Record<string, unknown>[] = [
    {
      domain: ".riotgames.com",
      httpOnly: true,
      name: "ssid",
      path: "/",
      secure: true,
      value: "offline-cookie-value",
    },
    {
      domain: "unrelated.example",
      name: "unrelated",
      path: "/",
      value: "preserved-value",
    },
  ],
): CapturedSession {
  return {
    capturedAt: "2026-08-13T00:00:00.000Z",
    fixtureOnly: true,
    kind: "captured-session",
    material: new TextEncoder().encode(JSON.stringify(cookies)),
    provider: "manual-cookie",
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function successfulReauthResponse(
  setCookie =
    "ssid=offline-rotated-value; Domain=.riotgames.com; Path=/; Secure; HttpOnly",
): Response {
  return new Response(null, {
    headers: {
      location: `https://playvalorant.com/opt_in#access_token=${ACCESS_TOKEN}&token_type=Bearer`,
      "set-cookie": setCookie,
    },
    status: 301,
  });
}

function fullFlowFetch(options?: {
  storefrontReject?: boolean;
  storefrontV3Status?: number;
}): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === REAUTH_URL) {
      return successfulReauthResponse();
    }
    if (url === "https://entitlements.auth.riotgames.com/api/token/v1") {
      return jsonResponse({ entitlements_token: ENTITLEMENTS_TOKEN });
    }
    if (url === "https://auth.riotgames.com/userinfo") {
      return jsonResponse({ sub: PUUID });
    }
    if (url === "https://valorant-api.com/v1/version") {
      return jsonResponse({
        data: { riotClientVersion: CLIENT_VERSION },
        status: 200,
      });
    }
    if (url.includes("/store/v3/storefront/")) {
      if (options?.storefrontReject) {
        throw new Error("offline transport failure");
      }
      return options?.storefrontV3Status
        ? new Response(null, { status: options.storefrontV3Status })
        : jsonResponse(storefrontFixture);
    }
    if (url.includes("/store/v2/storefront/")) {
      return jsonResponse(storefrontFixture);
    }

    throw new Error("Unexpected offline request");
  });
}

describe("Riot reauth classification", () => {
  it("maps only the known success and login redirects authoritatively", () => {
    expect(
      classifyReauthLocation(
        "https://playvalorant.com/opt_in#access_token=offline-value",
      ),
    ).toBe("OK");
    expect(
      classifyReauthLocation(
        "https://authenticate.riotgames.com/login?client_id=offline",
      ),
    ).toBe("DEAD");
    expect(
      classifyReauthLocation(
        "https://playvalorant.com.evil.example/opt_in#access_token=offline",
      ),
    ).toBe("UNKNOWN");
    expect(classifyReauthLocation(null)).toBe("UNKNOWN");
  });

  it("surfaces the lifecycle class without echoing redirect material", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        headers: {
          location:
            "https://authenticate.riotgames.com/login?value=do-not-echo",
        },
        status: 303,
      }),
    );
    const client = new RiotClient({
      fetchImplementation: fetchMock,
      session: sessionWithCookies(),
    });

    try {
      await client.authenticate();
      expect.unreachable("A login redirect is an authoritative dead session.");
    } catch (error) {
      expect(error).toBeInstanceOf(RiotClientError);
      expect((error as RiotClientError).classification).toBe("DEAD");
      expect((error as Error).message).not.toContain("do-not-echo");
    }
  });

  it("classifies transport errors as ERROR", async () => {
    const client = new RiotClient({
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("sensitive transport detail")),
      session: sessionWithCookies(),
    });

    await expect(client.authenticate()).rejects.toMatchObject({
      classification: "ERROR",
      message: "Riot request could not be completed.",
    });
  });
});

describe("RiotClient", () => {
  it("reauthenticates manually and returns the full rotated cookie jar", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(successfulReauthResponse());
    const client = new RiotClient({
      fetchImplementation: fetchMock,
      now: () => new Date("2026-08-14T00:05:00.000Z"),
      session: sessionWithCookies(),
    });

    const refreshed = await client.authenticate();
    const storedCookies = JSON.parse(
      new TextDecoder().decode(refreshed.material),
    ) as Array<Record<string, unknown>>;

    expect(refreshed.capturedAt).toBe("2026-08-14T00:05:00.000Z");
    expect(storedCookies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: ".riotgames.com",
          name: "ssid",
          value: "offline-rotated-value",
        }),
        expect.objectContaining({
          domain: "unrelated.example",
          name: "unrelated",
          value: "preserved-value",
        }),
      ]),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(REAUTH_URL);
    expect(init).toEqual(
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("cookie")).toBe("ssid=offline-cookie-value");
    expect(headers.get("user-agent")).toBe(RIOT_USER_AGENT);
  });

  it("gets entitlements, PUUID, version, and a v3 storefront in order", async () => {
    const fetchMock = fullFlowFetch();
    const client = new RiotClient({
      fetchImplementation: fetchMock,
      session: sessionWithCookies(),
    });

    const refreshed = await client.authenticate();
    await client.prepareStorefront(refreshed);
    const storefront = await client.getStore(refreshed);

    expect(storefront.levelUuids).toHaveLength(4);
    expect(storefront.payload).toEqual(storefrontFixture);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      REAUTH_URL,
      "https://entitlements.auth.riotgames.com/api/token/v1",
      "https://auth.riotgames.com/userinfo",
      "https://valorant-api.com/v1/version",
      `https://pd.ap.a.pvp.net/store/v3/storefront/${PUUID}`,
    ]);

    const entitlementInit = fetchMock.mock.calls[1][1];
    expect(entitlementInit?.method).toBe("POST");
    expect(new Headers(entitlementInit?.headers).get("authorization")).toBe(
      `Bearer ${ACCESS_TOKEN}`,
    );

    const userInfoInit = fetchMock.mock.calls[2][1];
    expect(userInfoInit?.method).toBe("GET");

    const storefrontInit = fetchMock.mock.calls[4][1];
    const storefrontHeaders = new Headers(storefrontInit?.headers);
    expect(storefrontInit?.method).toBe("POST");
    expect(storefrontHeaders.get("user-agent")).toBe(RIOT_USER_AGENT);
    expect(storefrontHeaders.get("x-riot-clientplatform")).toBe(
      RIOT_CLIENT_PLATFORM,
    );
    expect(storefrontHeaders.get("x-riot-clientversion")).toBe(CLIENT_VERSION);
    expect(storefrontHeaders.get("x-riot-entitlements-jwt")).toBe(
      ENTITLEMENTS_TOKEN,
    );
  });

  it("uses the stored account region without issuing a second fallback request", async () => {
    const fetchMock = fullFlowFetch({ storefrontV3Status: 404 });
    const client = new RiotClient({
      account: { region: "eu" },
      fetchImplementation: fetchMock,
      session: sessionWithCookies(),
    });

    const refreshed = await client.authenticate();
    await expect(client.getRegion(refreshed)).resolves.toBe("eu");
    await expect(client.getStore(refreshed)).rejects.toMatchObject({
      status: 404,
      storefrontRequest: "completed",
    });

    const calls = fetchMock.mock.calls;
    expect(calls.at(-1)?.[0]).toBe(
      `https://pd.eu.a.pvp.net/store/v3/storefront/${PUUID}`,
    );
    expect(calls.at(-1)?.[1]?.method).toBe("POST");
    expect(
      calls.filter(([url]) => String(url).includes("/store/")),
    ).toHaveLength(1);
  });

  it("marks a rejected sole storefront fetch as ambiguous", async () => {
    const fetchMock = fullFlowFetch({ storefrontReject: true });
    const client = new RiotClient({
      fetchImplementation: fetchMock,
      session: sessionWithCookies(),
    });

    const refreshed = await client.authenticate();
    await client.prepareStorefront(refreshed);

    await expect(client.getStore(refreshed)).rejects.toMatchObject({
      classification: "ERROR",
      status: null,
      storefrontRequest: "ambiguous",
    });
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/store/")),
    ).toHaveLength(1);
  });

  it("requires successful reauth before protected calls", async () => {
    const client = new RiotClient({
      fetchImplementation: vi.fn<typeof fetch>(),
      session: sessionWithCookies(),
    });

    await expect(client.getStore(sessionWithCookies())).rejects.toMatchObject({
      classification: "ERROR",
    });
  });

  it("accepts an equal refreshed-session clone but rejects different material", async () => {
    const client = new RiotClient({
      fetchImplementation: fullFlowFetch(),
      session: sessionWithCookies(),
    });
    const refreshed = await client.authenticate();
    const clonedSession: CapturedSession = {
      ...refreshed,
      material: new Uint8Array(refreshed.material),
    };

    await expect(client.getStore(clonedSession)).resolves.toMatchObject({
      levelUuids: expect.any(Array),
      payload: storefrontFixture,
    });

    const differentMaterial = new Uint8Array(refreshed.material);
    differentMaterial[differentMaterial.length - 1] ^= 1;
    await expect(
      client.getStore({ ...refreshed, material: differentMaterial }),
    ).rejects.toMatchObject({ classification: "ERROR" });
  });

  it("keeps health checks offline-injectable and redacts malformed data", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { riotClientVersion: "" } }));
    const client = new RiotClient({
      fetchImplementation: fetchMock,
      session: sessionWithCookies(),
    });

    await expect(client.healthCheck()).resolves.toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
