import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const PASSWORD = "correct-horse-battery-staple";
const USERNAME = "operator";

type Recorded = {
  body: unknown;
  cookie: string;
  method: string;
};

function jsonResponse(
  payload: unknown,
  setCookie: readonly string[] = [],
  status = 200,
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of setCookie) {
    headers.append("set-cookie", cookie);
  }

  return new Response(JSON.stringify(payload), { headers, status });
}

// A Response body can only be read once, so each use needs a fresh instance.
function opened(): Response {
  return jsonResponse({ type: "auth" }, [
    "asid=pending-value; Domain=auth.riotgames.com; Path=/; Secure; HttpOnly",
  ]);
}

const SUCCESS_PAYLOAD = {
  response: {
    parameters: {
      uri: "https://playvalorant.com/opt_in#access_token=redacted&id_token=redacted",
    },
  },
  type: "response",
};

const SESSION_COOKIES = [
  "ssid=live-session-value; Domain=auth.riotgames.com; Path=/; Secure; HttpOnly",
  "sub=subject-value; Domain=auth.riotgames.com; Path=/; Secure",
];

function recordingFetch(responses: readonly Response[]) {
  const calls: Recorded[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (_url: unknown, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
      cookie: headers.Cookie ?? "",
      method: init.method ?? "GET",
    });

    const next = queue.shift();
    if (!next) {
      throw new Error("Unexpected extra request.");
    }

    return next;
  });

  return { calls, fetchMock };
}

async function loadProvider() {
  const { RiotLoginProvider, RiotLoginError } = await import(
    "@/src/lib/riot/login-provider"
  );
  return { RiotLoginError, RiotLoginProvider };
}

describe("RiotLoginProvider", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("exchanges a credential for a cookie jar without returning the password", async () => {
    const { RiotLoginProvider } = await loadProvider();
    const { calls, fetchMock } = recordingFetch([
      opened(),
      jsonResponse(SUCCESS_PAYLOAD, SESSION_COOKIES),
    ]);

    const outcome = await new RiotLoginProvider({
      fetchImplementation: fetchMock as unknown as typeof fetch,
    }).submitCredentials({ password: PASSWORD, username: USERNAME });

    expect(outcome.kind).toBe("connected");
    if (outcome.kind !== "connected") {
      throw new Error("unreachable");
    }

    // Step one opens the flow; step two carries the credential and reuses asid.
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("POST");
    expect(calls[1].method).toBe("PUT");
    expect(calls[1].cookie).toContain("asid=pending-value");

    const jar = JSON.parse(
      new TextDecoder().decode(outcome.session.material),
    ) as { name: string; value: string }[];
    expect(jar.map((cookie) => cookie.name).sort()).toEqual([
      "asid",
      "ssid",
      "sub",
    ]);
    expect(outcome.session.provider).toBe("riot-login");
    expect(outcome.session.fixtureOnly).toBe(false);

    // The credential must not survive anywhere in what the provider hands back.
    expect(JSON.stringify(outcome)).not.toContain(PASSWORD);
    expect(new TextDecoder().decode(outcome.session.material)).not.toContain(
      PASSWORD,
    );
  });

  it("sends the credential exactly once, to the documented auth endpoint", async () => {
    const { RiotLoginProvider } = await loadProvider();
    const { calls, fetchMock } = recordingFetch([
      opened(),
      jsonResponse(SUCCESS_PAYLOAD, SESSION_COOKIES),
    ]);

    await new RiotLoginProvider({
      fetchImplementation: fetchMock as unknown as typeof fetch,
    }).submitCredentials({ password: PASSWORD, username: USERNAME });

    const carrying = calls.filter((call) =>
      JSON.stringify(call.body).includes(PASSWORD),
    );
    expect(carrying).toHaveLength(1);
    expect(carrying[0].body).toMatchObject({
      remember: true,
      type: "auth",
      username: USERNAME,
    });

    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe("https://auth.riotgames.com/api/v1/authorization");
    }
  });

  it("surfaces an MFA challenge with a pending jar and no credential", async () => {
    const { RiotLoginProvider } = await loadProvider();
    const { fetchMock } = recordingFetch([
      opened(),
      jsonResponse({
        multifactor: { email: "o•••@example.com", method: "email" },
        type: "multifactor",
      }),
    ]);

    const outcome = await new RiotLoginProvider({
      fetchImplementation: fetchMock as unknown as typeof fetch,
    }).submitCredentials({ password: PASSWORD, username: USERNAME });

    expect(outcome.kind).toBe("multifactor");
    if (outcome.kind !== "multifactor") {
      throw new Error("unreachable");
    }

    expect(outcome.maskedTarget).toBe("o•••@example.com");
    expect(outcome.method).toBe("email");
    expect(new TextDecoder().decode(outcome.pendingJar)).toContain("asid");
    expect(new TextDecoder().decode(outcome.pendingJar)).not.toContain(PASSWORD);
  });

  it("completes a challenged sign-in from the pending jar", async () => {
    const { RiotLoginProvider } = await loadProvider();
    const { calls, fetchMock } = recordingFetch([
      jsonResponse(SUCCESS_PAYLOAD, SESSION_COOKIES),
    ]);
    const pendingJar = new TextEncoder().encode(
      JSON.stringify([
        {
          domain: "auth.riotgames.com",
          name: "asid",
          path: "/",
          value: "pending-value",
        },
      ]),
    );

    const outcome = await new RiotLoginProvider({
      fetchImplementation: fetchMock as unknown as typeof fetch,
    }).submitMfaCode({ code: "123456", pendingJar });

    expect(outcome.kind).toBe("connected");
    expect(calls[0].body).toEqual({
      code: "123456",
      rememberDevice: true,
      type: "multifactor",
    });
    expect(calls[0].cookie).toContain("asid=pending-value");
  });

  it("classifies rejected credentials, bad codes, and rate limiting", async () => {
    const { RiotLoginError, RiotLoginProvider } = await loadProvider();

    const rejected = recordingFetch([
      opened(),
      jsonResponse({ error: "auth_failure", type: "auth" }),
    ]);
    await expect(
      new RiotLoginProvider({
        fetchImplementation: rejected.fetchMock as unknown as typeof fetch,
      }).submitCredentials({ password: PASSWORD, username: USERNAME }),
    ).rejects.toMatchObject({ failure: "invalid-credentials" });

    const badCode = recordingFetch([
      jsonResponse({ error: "multifactor_attempt_failed", type: "multifactor" }),
    ]);
    await expect(
      new RiotLoginProvider({
        fetchImplementation: badCode.fetchMock as unknown as typeof fetch,
      }).submitMfaCode({
        code: "000000",
        pendingJar: new TextEncoder().encode(
          JSON.stringify([
            { domain: "auth.riotgames.com", name: "asid", path: "/", value: "p" },
          ]),
        ),
      }),
    ).rejects.toMatchObject({ failure: "invalid-mfa-code" });

    const limited = recordingFetch([
      opened(),
      jsonResponse({ type: "auth" }, [], 429),
    ]);
    await expect(
      new RiotLoginProvider({
        fetchImplementation: limited.fetchMock as unknown as typeof fetch,
      }).submitCredentials({ password: PASSWORD, username: USERNAME }),
    ).rejects.toBeInstanceOf(RiotLoginError);
  });

  it("treats a Cloudflare challenge as unavailable so the fallback can be used", async () => {
    const { RiotLoginProvider } = await loadProvider();
    const { fetchMock } = recordingFetch([
      new Response("<html>denied</html>", { status: 403 }),
    ]);

    await expect(
      new RiotLoginProvider({
        fetchImplementation: fetchMock as unknown as typeof fetch,
      }).submitCredentials({ password: PASSWORD, username: USERNAME }),
    ).rejects.toMatchObject({ failure: "unavailable" });
  });

  it("keeps the credential out of thrown errors and console output", async () => {
    const { RiotLoginProvider } = await loadProvider();
    const consoleSpies = (["error", "info", "log", "warn"] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const failing = vi.fn(async () => {
      throw new Error("socket hang up");
    });

    let thrown: unknown;
    try {
      await new RiotLoginProvider({
        fetchImplementation: failing as unknown as typeof fetch,
      }).submitCredentials({ password: PASSWORD, username: USERNAME });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const serialized = `${String(thrown)}${(thrown as Error).stack ?? ""}`;
    expect(serialized).not.toContain(PASSWORD);

    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(PASSWORD);
      }
      spy.mockRestore();
    }
  });

  it("rejects malformed input before opening a request", async () => {
    const { RiotLoginProvider } = await loadProvider();
    const { fetchMock } = recordingFetch([]);
    const provider = new RiotLoginProvider({
      fetchImplementation: fetchMock as unknown as typeof fetch,
    });

    await expect(
      provider.submitCredentials({ password: "", username: USERNAME }),
    ).rejects.toMatchObject({ failure: "malformed-input" });
    await expect(
      provider.submitCredentials({ password: PASSWORD, username: "   " }),
    ).rejects.toMatchObject({ failure: "malformed-input" });
    await expect(
      provider.submitMfaCode({
        code: "12ab56",
        pendingJar: new TextEncoder().encode("[]"),
      }),
    ).rejects.toMatchObject({ failure: "invalid-mfa-code" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a rejected auth session as expired, not as a bad credential", async () => {
    const { RiotLoginProvider } = await loadProvider();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchMock } = recordingFetch([
      opened(),
      jsonResponse({ error: "invalid_session_id", type: "auth" }),
    ]);

    // Riot never evaluated the password here: the asid cookie was refused.
    // Calling this "invalid-credentials" would send the user to re-check a
    // password that was correct all along.
    await expect(
      new RiotLoginProvider({
        fetchImplementation: fetchMock as unknown as typeof fetch,
      }).submitCredentials({ password: PASSWORD, username: USERNAME }),
    ).rejects.toMatchObject({ failure: "session-expired" });

    warn.mockRestore();
  });

  it("reports an unusable pending jar as expired so the user restarts", async () => {
    const { RiotLoginProvider } = await loadProvider();
    const { fetchMock } = recordingFetch([]);

    await expect(
      new RiotLoginProvider({
        fetchImplementation: fetchMock as unknown as typeof fetch,
      }).submitMfaCode({
        code: "123456",
        pendingJar: new TextEncoder().encode("not-a-jar"),
      }),
    ).rejects.toMatchObject({ failure: "session-expired" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs the failing step and Riot's error code, and nothing secret", async () => {
    const { RiotLoginProvider } = await loadProvider();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchMock } = recordingFetch([
      opened(),
      jsonResponse({ error: "auth_failure", type: "auth" }),
    ]);

    await expect(
      new RiotLoginProvider({
        fetchImplementation: fetchMock as unknown as typeof fetch,
      }).submitCredentials({ password: PASSWORD, username: USERNAME }),
    ).rejects.toMatchObject({ failure: "invalid-credentials" });

    // Without this line a failed sign-in is indistinguishable on the server
    // from a Cloudflare refusal or an expired auth session.
    expect(warn).toHaveBeenCalledWith(
      "[riot-login] sign-in step failed",
      expect.objectContaining({
        riotError: "auth_failure",
        riotType: "auth",
        step: "credential",
      }),
    );

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain("pending-value");
    warn.mockRestore();
  });
});
