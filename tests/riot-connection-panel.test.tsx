/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RiotConnectionPanel } from "@/app/dashboard/riot-connection-panel";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

beforeEach(() => {
  setUserAgent(CHROME_UA);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const JAR = JSON.stringify([
  {
    domain: ".riotgames.com",
    name: "ssid",
    path: "/",
    value: "offline-session-value",
  },
]);

async function revealJarPaste(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByRole("textbox", { name: "Riot cookie JSON" })) {
    await user.click(screen.getByRole("button", { name: "Use cookie JSON" }));
  }
}

describe("Riot connection consent UI", () => {
  it("hands a one-time token to the installed extension and finishes automatically", async () => {
    const user = userEvent.setup();
    const createCaptureToken = vi.fn().mockResolvedValue({
      ok: true,
      token: "a".repeat(43),
    });
    const webMessages: unknown[] = [];
    const collectWebMessages = (event: MessageEvent) => {
      if (event.data?.source === "val-checker-web") {
        webMessages.push(event.data);
      }
    };
    window.addEventListener("message", collectWebMessages);

    render(
      <RiotConnectionPanel
        connectSession={vi.fn()}
        createCaptureToken={createCaptureToken}
        initialLabel="Main"
        initialRegion="ap"
        initialState="disconnected"
      />,
    );

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "val-checker-extension",
          type: "VAL_CHECKER_EXTENSION_READY",
        },
        origin: window.location.origin,
        source: window,
      }),
    );

    expect(
      await screen.findByText("Extension ready"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sign in with Riot" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Riot password")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in with Riot" }));

    await waitFor(() => expect(createCaptureToken).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting for Riot sign-in",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Finish signing in on the Riot tab we opened",
    );
    const start = await waitFor(() => {
      const message = webMessages.find(
        (candidate) =>
          typeof candidate === "object" &&
          candidate !== null &&
          (candidate as { type?: unknown }).type ===
            "VAL_CHECKER_RIOT_CONNECT_START",
      );
      expect(message).toBeDefined();
      return message as {
        payload: { label: string; region: string; requestId: string; token: string };
      };
    });
    expect(start.payload).toMatchObject({
      label: "Main",
      region: "ap",
      token: "a".repeat(43),
    });
    expect(start.payload).not.toHaveProperty("jar");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          ok: true,
          requestId: start.payload.requestId,
          source: "val-checker-extension",
          type: "VAL_CHECKER_RIOT_CONNECT_RESULT",
        },
        origin: window.location.origin,
        source: window,
      }),
    );

    expect(
      await screen.findByText(/Riot account connected/i),
    ).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
    window.removeEventListener("message", collectWebMessages);
  });

  it("offers a one-time extension download while keeping JSON as fallback", async () => {
    const user = userEvent.setup();
    render(
      <RiotConnectionPanel
        connectSession={vi.fn()}
        createCaptureToken={vi.fn()}
        initialState="disconnected"
      />,
    );

    expect(
      await screen.findByText("Extension needed", {}, { timeout: 2_000 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Chrome detected", {}, { timeout: 2_000 }),
    ).toBeInTheDocument();
    const download = screen.getByRole("link", { name: "Download for Chrome" });
    expect(download).toHaveAttribute(
      "href",
      "/downloads/val-checker-chromium-extension.zip",
    );
    expect(download).toHaveAttribute(
      "download",
      "val-checker-chromium-extension.zip",
    );

    const signIn = screen.getByRole("button", { name: "Sign in with Riot" });
    await user.hover(signIn);
    expect(
      screen.getByText("Download and unzip the extension first."),
    ).toBeInTheDocument();
    expect(download).toHaveClass("riot-connect-download-link-highlighted");

    await user.click(signIn);
    expect(download).toHaveFocus();
    expect(
      screen.getByRole("heading", { name: "Import cookie JSON" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Riot cookie JSON" }),
    ).not.toBeInTheDocument();
  });

  it("labels the download for each detected browser without saying Chromium", async () => {
    const cases = [
      {
        expected: "Microsoft Edge detected",
        href: "/downloads/val-checker-chromium-extension.zip",
        label: "Download for Microsoft Edge",
        userAgent: `${CHROME_UA} Edg/126.0.0.0`,
      },
      {
        expected: "Opera GX detected",
        href: "/downloads/val-checker-chromium-extension.zip",
        label: "Download for Opera GX",
        userAgent: `${CHROME_UA} OPR/112.0.0.0 OPX/112.0.0.0`,
      },
      {
        expected: "Firefox detected",
        href: "/downloads/val-checker-firefox-extension-unsigned.zip",
        label: "Install for Firefox",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
      },
    ];

    for (const scenario of cases) {
      setUserAgent(scenario.userAgent);
      render(
        <RiotConnectionPanel
          createCaptureToken={vi.fn()}
          initialState="disconnected"
        />,
      );

      expect(
        await screen.findByText(scenario.expected, {}, { timeout: 2_000 }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: scenario.label }),
      ).toHaveAttribute("href", scenario.href);
      expect(screen.queryByText(/Chromium detected/)).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("keeps the download reachable when the browser cannot be identified", async () => {
    const user = userEvent.setup();
    setUserAgent("Mozilla/5.0 (Unknown) SomeUnlistedBrowser/1.0");
    render(
      <RiotConnectionPanel
        createCaptureToken={vi.fn()}
        initialState="disconnected"
      />,
    );

    expect(
      await screen.findByText("Choose your browser", {}, { timeout: 2_000 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Chrome / Chromium" }));

    expect(screen.getByText("Chrome selected")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download for Chrome" }),
    ).toHaveAttribute("href", "/downloads/val-checker-chromium-extension.zip");
  });

  it("lets a detected browser be overridden by hand", async () => {
    const user = userEvent.setup();
    render(
      <RiotConnectionPanel
        createCaptureToken={vi.fn()}
        initialState="disconnected"
      />,
    );

    expect(
      await screen.findByText("Chrome detected", {}, { timeout: 2_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Using another browser?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Firefox" }));

    expect(screen.getByText("Firefox selected")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Install for Firefox" }),
    ).toHaveAttribute(
      "href",
      "/downloads/val-checker-firefox-extension-unsigned.zip",
    );
  });

  it("refuses to hand a Chromium package to Safari or a phone", async () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    );
    render(
      <RiotConnectionPanel
        createCaptureToken={vi.fn()}
        initialState="disconnected"
      />,
    );
    expect(
      await screen.findByText(
        "This browser isn’t supported yet.",
        {},
        { timeout: 2_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    cleanup();

    setUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    );
    render(
      <RiotConnectionPanel
        createCaptureToken={vi.fn()}
        initialState="disconnected"
      />,
    );
    expect(
      await screen.findByText(
        "Riot connection currently requires a desktop browser.",
        {},
        { timeout: 2_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the detected browser's own steps inside the tutorial", async () => {
    const user = userEvent.setup();
    setUserAgent(`${CHROME_UA} Edg/126.0.0.0`);
    render(
      <RiotConnectionPanel
        createCaptureToken={vi.fn()}
        initialState="disconnected"
      />,
    );

    await user.click(screen.getByRole("button", { name: "How to connect" }));
    const dialog = screen.getByRole("dialog", {
      name: "How to connect your Riot account",
    });
    expect(dialog).toHaveTextContent("Open edge://extensions.");
    expect(dialog).not.toHaveTextContent("chrome://extensions");
    expect(
      screen.getByRole("link", { name: "Download for Microsoft Edge" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    cleanup();

    setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
    );
    render(
      <RiotConnectionPanel
        createCaptureToken={vi.fn()}
        initialState="disconnected"
      />,
    );
    await user.click(screen.getByRole("button", { name: "How to connect" }));
    const firefoxDialog = screen.getByRole("dialog", {
      name: "How to connect your Riot account",
    });
    expect(firefoxDialog).toHaveTextContent(
      "Open about:debugging#/runtime/this-firefox.",
    );
    expect(firefoxDialog).toHaveTextContent("Load Temporary Add-on");
    expect(firefoxDialog).toHaveTextContent(/development install/i);
    expect(firefoxDialog.querySelector("img")).toBeNull();
  });

  it("places consent after the primary action and opens the setup guide", async () => {
    const user = userEvent.setup();
    render(
      <RiotConnectionPanel
        connectSession={vi.fn()}
        createCaptureToken={vi.fn()}
        initialState="disconnected"
      />,
    );

    const signIn = screen.getByRole("button", { name: "Sign in with Riot" });
    const consent = screen.getByRole("checkbox");
    expect(
      signIn.compareDocumentPosition(consent) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "How to connect" }));
    expect(
      screen.getByRole("dialog", { name: "How to connect your Riot account" }),
    ).toBeInTheDocument();
    expect(
      screen.getByAltText(/Eight-step guide/i),
    ).toHaveAttribute(
      "src",
      expect.stringContaining("val-checker-riot-account-setup-guide.png"),
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "How to connect" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "How to connect" }));
    fireEvent.mouseDown(
      screen.getByRole("dialog", {
        name: "How to connect your Riot account",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("turns an undetected extension callback into an actionable retry", async () => {
    const user = userEvent.setup();
    const createCaptureToken = vi.fn().mockResolvedValue({
      ok: true,
      token: "a".repeat(43),
    });
    let requestId = "";
    const collectWebMessages = (event: MessageEvent) => {
      if (event.data?.type === "VAL_CHECKER_RIOT_CONNECT_START") {
        requestId = event.data.payload.requestId;
      }
    };
    window.addEventListener("message", collectWebMessages);

    render(
      <RiotConnectionPanel
        createCaptureToken={createCaptureToken}
        initialState="disconnected"
      />,
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "val-checker-extension",
          type: "VAL_CHECKER_EXTENSION_READY",
        },
        origin: window.location.origin,
        source: window,
      }),
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in with Riot" }));
    await waitFor(() => expect(requestId).not.toBe(""));

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          ok: false,
          reason: "expired",
          requestId,
          source: "val-checker-extension",
          type: "VAL_CHECKER_RIOT_CONNECT_RESULT",
        },
        origin: window.location.origin,
        source: window,
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Riot sign-in wasn’t detected",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "How to connect" })).toBeEnabled();
    window.removeEventListener("message", collectWebMessages);
  });

  it("makes web sign-in primary and cookie JSON an explicit fallback", async () => {
    const user = userEvent.setup();
    render(
      <RiotConnectionPanel
        cloudConnectAvailable
        connectSession={vi.fn()}
        initialState="disconnected"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Sign in with Riot", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Import cookie JSON" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Riot cookie JSON" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in with Riot" }));
    expect(router.push).toHaveBeenCalledWith("/connect/riot?region=ap");
  });

  it("explains fallback-only mode and opens the usable JSON form", () => {
    render(
      <RiotConnectionPanel
        connectSession={vi.fn()}
        initialState="disconnected"
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Sign in with Riot is temporarily unavailable",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Available now")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Riot cookie JSON" }),
    ).toBeInTheDocument();
    expect(screen.getByText("New account")).toBeInTheDocument();
  });

  it("exercises fixture-only connect and disconnect behavior", async () => {
    const user = userEvent.setup();
    const connectFixture = vi.fn().mockResolvedValue({ ok: true });
    const disconnect = vi.fn().mockResolvedValue({ ok: true });
    render(
      <RiotConnectionPanel
        connectFixture={connectFixture}
        disconnect={disconnect}
        initialState="disconnected"
      />,
    );

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Connect fixture session" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Fixture connected" })).toBeInTheDocument();
    });
    expect(connectFixture).toHaveBeenCalledWith(true);

    await user.click(
      screen.getByRole("button", { name: "Disconnect and delete stored session" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Connect a Riot account" }),
      ).toBeInTheDocument();
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("signs in with credentials and the AP region default", async () => {
    const user = userEvent.setup();
    const connectCredentials = vi
      .fn()
      .mockResolvedValue({ ok: true, status: "connected" });

    render(
      <RiotConnectionPanel
        connectCredentials={connectCredentials}
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    await user.type(screen.getByLabelText("Riot username"), "operator");
    await user.type(screen.getByLabelText("Riot password"), "correct horse");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in to Riot" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Riot connected" }),
      ).toBeInTheDocument();
    });
    expect(connectCredentials).toHaveBeenCalledWith({
      consentGranted: true,
      label: undefined,
      password: "correct horse",
      region: "ap",
      username: "operator",
    });
  });

  it("collects an MFA code when Riot challenges the sign-in", async () => {
    const user = userEvent.setup();
    const connectCredentials = vi.fn().mockResolvedValue({
      maskedTarget: "o•••@example.com",
      method: "email",
      ok: true,
      status: "multifactor-required",
    });
    const submitMfaCode = vi
      .fn()
      .mockResolvedValue({ ok: true, status: "connected" });

    render(
      <RiotConnectionPanel
        connectCredentials={connectCredentials}
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
        submitMfaCode={submitMfaCode}
      />,
    );

    await user.type(screen.getByLabelText("Riot username"), "operator");
    await user.type(screen.getByLabelText("Riot password"), "correct horse");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in to Riot" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("o•••@example.com");
    });

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and connect" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Riot connected" }),
      ).toBeInTheDocument();
    });
    expect(submitMfaCode).toHaveBeenCalledWith({ code: "123456" });
  });

  it("resets account-specific form and MFA state when the reconnect target changes", async () => {
    const user = userEvent.setup();
    const connectCredentials = vi.fn().mockResolvedValue({
      maskedTarget: "m•••@example.com",
      method: "email",
      ok: true,
      status: "multifactor-required",
    });
    const sharedProps = {
      connectCredentials,
      initialState: "disconnected" as const,
      submitMfaCode: vi.fn(),
    };
    const { rerender } = render(
      <RiotConnectionPanel
        {...sharedProps}
        initialLabel="Main"
        initialRegion="ap"
        targetConnectionId="11111111-1111-4111-8111-111111111111"
      />,
    );

    await user.type(screen.getByLabelText("Riot username"), "operator");
    await user.type(screen.getByLabelText("Riot password"), "correct horse");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in to Riot" }));
    expect(await screen.findByLabelText("Verification code")).toBeInTheDocument();

    rerender(
      <RiotConnectionPanel
        {...sharedProps}
        initialLabel="Alt"
        initialRegion="na"
        targetConnectionId="22222222-2222-4222-8222-222222222222"
      />,
    );

    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Riot username")).toHaveValue("");
    expect(screen.getByLabelText("Riot password")).toHaveValue("");
    expect(screen.getByLabelText("Account name (optional)")).toHaveValue("Alt");
    expect(screen.getByLabelText("Account region")).toHaveValue("na");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("clears an earlier success before reporting a later add-account failure", async () => {
    const user = userEvent.setup();
    const connectCredentials = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: "connected" })
      .mockResolvedValueOnce({ error: "Riot sign-in is unavailable.", ok: false });
    render(
      <RiotConnectionPanel
        connectCredentials={connectCredentials}
        initialState="disconnected"
        keepConnectFormOpen
      />,
    );

    for (const [label, value] of [
      ["Riot username", "first"],
      ["Riot password", "first-password"],
    ] as const) {
      await user.type(screen.getByLabelText(label), value);
    }
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in to Riot" }));
    expect(
      await screen.findByText(/Riot account connected/i),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Riot username"), "second");
    await user.type(screen.getByLabelText("Riot password"), "second-password");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in to Riot" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Riot sign-in is unavailable.",
    );
    expect(screen.queryByText(/Riot account connected/i)).not.toBeInTheDocument();
  });

  it("drops the password from the form on every outcome", async () => {
    const user = userEvent.setup();
    const connectCredentials = vi.fn().mockResolvedValue({
      error: "Riot rejected that username or password.",
      ok: false,
    });

    render(
      <RiotConnectionPanel
        connectCredentials={connectCredentials}
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    const password = screen.getByLabelText("Riot password");
    await user.type(screen.getByLabelText("Riot username"), "operator");
    await user.type(password, "correct horse");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in to Riot" }));

    await waitFor(() => expect(password).toHaveValue(""));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Riot rejected that username or password.",
    );
  });

  it("hides the cookie export fallback from non-admins", () => {
    render(
      <RiotConnectionPanel
        connectCredentials={vi.fn()}
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    expect(
      screen.queryByRole("textbox", { name: "Riot cookie JSON" }),
    ).not.toBeInTheDocument();
  });

  it("submits admin cookie material with consent and the AP default", async () => {
    const user = userEvent.setup();
    const connectSession = vi.fn().mockResolvedValue({ ok: true });

    render(
      <RiotConnectionPanel
        connectCredentials={vi.fn()}
        connectSession={connectSession}
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    await revealJarPaste(user);
    expect(
      screen.getByText(/contacts Riot to verify which account the session belongs to/i),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Riot cookie JSON" }),
      { target: { value: JAR } },
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Connect with cookie JSON" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Riot connected" })).toBeInTheDocument();
    });
    expect(connectSession).toHaveBeenCalledWith({
      consentGranted: true,
      region: "ap",
      serializedJar: JAR,
    });
  });

  it("clears submitted session material after a rejected connection attempt", async () => {
    const user = userEvent.setup();
    const connectSession = vi.fn().mockResolvedValue({
      error: "The Riot session could not be connected.",
      ok: false,
    });
    render(
      <RiotConnectionPanel
        connectCredentials={vi.fn()}
        connectSession={connectSession}
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    await revealJarPaste(user);
    const input = screen.getByRole("textbox", { name: "Riot cookie JSON" });

    fireEvent.change(input, { target: { value: "sensitive-session-material" } });
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Connect with cookie JSON" }),
    );

    await waitFor(() => expect(input).toHaveValue(""));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Riot session could not be connected.",
    );
  });

  it("plainly discloses credential handling, storage, encryption, revocation, and Riot logout", () => {
    render(
      <RiotConnectionPanel
        connectCredentials={vi.fn()}
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    expect(
      screen.getByText(/username, password, and any MFA code are sent through/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not store or log them/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sign in with Riot credentials" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Use your Riot login username/i)).toBeInTheDocument();
    expect(
      screen.getByText(/can permit access to your Riot account/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/encrypted at rest/i)).toBeInTheDocument();
    expect(screen.getByText(/disconnect and delete it/i)).toBeInTheDocument();
    expect(screen.getByText(/not affiliated with Riot Games/i)).toBeInTheDocument();
    expect(screen.getByText(/Sign out everywhere/i)).toBeInTheDocument();
    expect(screen.getByText(/complete renewable cookie jar/i)).toBeInTheDocument();
    expect(screen.queryByText(/temporary browser/i)).not.toBeInTheDocument();
  });
});
