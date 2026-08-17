/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RiotConnectionPanel } from "@/app/dashboard/riot-connection-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

const JAR = JSON.stringify([
  {
    domain: ".riotgames.com",
    name: "ssid",
    path: "/",
    value: "offline-session-value",
  },
]);

async function revealJarPaste() {
  // The captured-session field is rendered directly now; kept so the tests
  // still read as "get to the paste step".
  await screen.findByRole("textbox", { name: "Captured Riot session" });
}

describe("Riot connection consent UI", () => {
  it("keeps production connection closed without accepting credential input", () => {
    render(
      <RiotConnectionPanel
        connectAllowed={false}
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Riot connection access not enabled" }),
    ).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Riot password")).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "limited to explicitly allowlisted accounts",
    );
  });

  it("exercises fixture-only connect and disconnect behavior", async () => {
    const user = userEvent.setup();
    const connectFixture = vi.fn().mockResolvedValue({ ok: true });
    const disconnect = vi.fn().mockResolvedValue({ ok: true });
    render(
      <RiotConnectionPanel
        connectAllowed
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
        connectAllowed
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
        connectAllowed
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
      connectAllowed: true,
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
        connectAllowed
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
        connectAllowed
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
        connectAllowed
        connectCredentials={vi.fn()}
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    expect(
      screen.queryByRole("textbox", { name: "Captured Riot session" }),
    ).not.toBeInTheDocument();
  });

  it("submits admin cookie material with consent and the AP default", async () => {
    const user = userEvent.setup();
    const connectSession = vi.fn().mockResolvedValue({ ok: true });

    render(
      <RiotConnectionPanel
        connectAllowed
        connectCredentials={vi.fn()}
        connectSession={connectSession}
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    await revealJarPaste();
    expect(
      screen.getByText(/contacts Riot to verify the account identity/i),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Captured Riot session" }),
      { target: { value: JAR } },
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Connect from cookie export" }),
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
        connectAllowed
        connectCredentials={vi.fn()}
        connectSession={connectSession}
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    await revealJarPaste();
    const input = screen.getByRole("textbox", { name: "Captured Riot session" });

    fireEvent.change(input, { target: { value: "sensitive-session-material" } });
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Connect from cookie export" }),
    );

    await waitFor(() => expect(input).toHaveValue(""));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Riot session could not be connected.",
    );
  });

  it("plainly discloses credential handling, storage, encryption, revocation, and Riot logout", () => {
    render(
      <RiotConnectionPanel
        connectAllowed={false}
        disconnect={vi.fn().mockResolvedValue({ ok: true })}
        initialState="disconnected"
      />,
    );

    expect(
      screen.getByText(/never stored, never written to our logs/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/can permit access to your Riot account/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/encrypted at rest/i)).toBeInTheDocument();
    expect(screen.getByText(/disconnect and delete it/i)).toBeInTheDocument();
    expect(screen.getByText(/not affiliated with Riot Games/i)).toBeInTheDocument();
    expect(screen.getByText(/Sign out everywhere/i)).toBeInTheDocument();
    expect(
      screen.getByText(/one automatic storefront check per UTC day/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/one separate manual refresh per UTC day/i),
    ).toBeInTheDocument();
  });
});
