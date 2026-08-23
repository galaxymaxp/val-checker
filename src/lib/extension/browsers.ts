/**
 * One configuration table drives every browser-specific string the Riot
 * connection card and tutorial show. Chrome, Edge, Brave, Opera, and Opera GX
 * install the same Chromium archive; only the wording, the extensions URL, and
 * Firefox's separate build differ.
 */

export type SupportedBrowser =
  | "chrome"
  | "edge"
  | "brave"
  | "opera"
  | "opera-gx"
  | "firefox"
  | "unknown";

export type ExtensionBuild = "chromium" | "firefox";

export interface ExtensionPackage {
  /** File name the download is saved as. */
  readonly filename: string;
  readonly href: string;
}

export interface BrowserProfile {
  /** Label of the download control, e.g. "Download for Opera GX". */
  readonly actionLabel: string;
  readonly build: ExtensionBuild;
  /** Short name shown to the user. Never mentions "Chromium". */
  readonly displayName: string;
  /** Where the user manages extensions in this browser. */
  readonly extensionsUrl: string;
  readonly id: Exclude<SupportedBrowser, "unknown">;
  /** Ordered installation steps for this browser. */
  readonly steps: readonly string[];
}

export const EXTENSION_PACKAGES: Record<ExtensionBuild, ExtensionPackage> = {
  chromium: {
    filename: "val-checker-chromium-extension.zip",
    href: "/downloads/val-checker-chromium-extension.zip",
  },
  // Mozilla signing is not configured yet, so this is the development build
  // rather than an installable .xpi. See the Firefox notes below.
  firefox: {
    filename: "val-checker-firefox-extension-unsigned.zip",
    href: "/downloads/val-checker-firefox-extension-unsigned.zip",
  },
};

function chromiumSteps(displayName: string, extensionsUrl: string) {
  return [
    `Download the VAL Checker extension ZIP for ${displayName}.`,
    "Extract All. Do not select the ZIP itself in the next steps.",
    `Open ${extensionsUrl}.`,
    "Enable Developer mode.",
    "Choose Load unpacked.",
    "Select the extracted folder containing manifest.json.",
    "Return to VAL Checker.",
    "Confirm Extension ready.",
    "Choose Sign in with Riot.",
  ] as const;
}

function chromiumProfile(
  id: Exclude<SupportedBrowser, "unknown" | "firefox">,
  displayName: string,
  extensionsUrl: string,
): BrowserProfile {
  return {
    actionLabel: `Download for ${displayName}`,
    build: "chromium",
    displayName,
    extensionsUrl,
    id,
    steps: chromiumSteps(displayName, extensionsUrl),
  };
}

export const BROWSER_PROFILES: Record<
  Exclude<SupportedBrowser, "unknown">,
  BrowserProfile
> = {
  brave: chromiumProfile("brave", "Brave", "brave://extensions"),
  chrome: chromiumProfile("chrome", "Chrome", "chrome://extensions"),
  edge: chromiumProfile("edge", "Microsoft Edge", "edge://extensions"),
  firefox: {
    actionLabel: "Install for Firefox",
    build: "firefox",
    displayName: "Firefox",
    extensionsUrl: "about:debugging#/runtime/this-firefox",
    id: "firefox",
    steps: [
      "Download the VAL Checker Firefox development build.",
      "Extract All.",
      "Open about:debugging#/runtime/this-firefox.",
      "Choose Load Temporary Add-on.",
      "Select manifest.json inside the extracted folder.",
      "If Firefox asks, allow the add-on to access riotgames.com and playvalorant.com.",
      "Return to VAL Checker.",
      "Confirm Extension ready.",
      "Choose Sign in with Riot.",
    ],
  },
  opera: chromiumProfile("opera", "Opera", "opera://extensions"),
  "opera-gx": chromiumProfile("opera-gx", "Opera GX", "opera://extensions"),
};

/**
 * Order matters in the manual picker and in the "supported browsers" copy.
 */
export const BROWSER_ORDER: readonly Exclude<SupportedBrowser, "unknown">[] = [
  "chrome",
  "edge",
  "brave",
  "opera",
  "opera-gx",
  "firefox",
];

export const SUPPORTED_BROWSER_NAMES = BROWSER_ORDER.map(
  (id) => BROWSER_PROFILES[id].displayName,
);

export function browserProfile(browser: SupportedBrowser) {
  return browser === "unknown" ? undefined : BROWSER_PROFILES[browser];
}

export function extensionPackage(browser: SupportedBrowser) {
  const profile = browserProfile(browser);
  return profile ? EXTENSION_PACKAGES[profile.build] : undefined;
}

/**
 * Firefox cannot install an unsigned add-on permanently in release builds, so
 * the flow above is explicitly a development install. Nothing in the UI claims
 * otherwise.
 */
export const FIREFOX_DISTRIBUTION_NOTE =
  "Firefox signing isn’t set up yet, so this is a development install: Firefox removes a temporary add-on when it closes. A signed add-on will replace this step.";
