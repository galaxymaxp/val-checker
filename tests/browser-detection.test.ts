import { describe, expect, it } from "vitest";

import {
  BROWSER_ORDER,
  BROWSER_PROFILES,
  EXTENSION_PACKAGES,
  extensionPackage,
} from "@/src/lib/extension/browsers";
import { detectBrowser } from "@/src/lib/extension/detect-browser";

const CHROMIUM_BASE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("browser detection", () => {
  it("names each supported desktop browser", () => {
    expect(detectBrowser({ userAgent: CHROMIUM_BASE }).browser).toBe("chrome");
    expect(
      detectBrowser({ userAgent: `${CHROMIUM_BASE} Edg/126.0.0.0` }).browser,
    ).toBe("edge");
    expect(
      detectBrowser({ isBrave: true, userAgent: CHROMIUM_BASE }).browser,
    ).toBe("brave");
    expect(
      detectBrowser({ userAgent: `${CHROMIUM_BASE} OPR/112.0.0.0` }).browser,
    ).toBe("opera");
    expect(
      detectBrowser({
        userAgent: `${CHROMIUM_BASE} OPR/112.0.0.0 OPX/112.0.0.0`,
      }).browser,
    ).toBe("opera-gx");
    expect(
      detectBrowser({
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
      }).browser,
    ).toBe("firefox");
  });

  it("prefers user-agent brands over the legacy string", () => {
    expect(
      detectBrowser({
        brands: [{ brand: "Chromium" }, { brand: "Opera GX" }],
        userAgent: CHROMIUM_BASE,
      }).browser,
    ).toBe("opera-gx");
    expect(
      detectBrowser({
        brands: [{ brand: "Not_A Brand" }, { brand: "Google Chrome" }],
        userAgent: CHROMIUM_BASE,
      }).browser,
    ).toBe("chrome");
  });

  it("does not guess an unrecognised browser", () => {
    expect(
      detectBrowser({ userAgent: "Mozilla/5.0 (Unknown) Weird/3.1" }),
    ).toEqual({ browser: "unknown", mobile: false, unsupported: false });

    // A Chromium fork we do not brand still reaches the manual picker.
    const vivaldi = detectBrowser({
      brands: [{ brand: "Chromium" }, { brand: "Vivaldi" }],
      userAgent: `${CHROMIUM_BASE} Vivaldi/6.8`,
    });
    expect(vivaldi.browser).toBe("unknown");
    expect(vivaldi.unsupported).toBe(false);
  });

  it("marks Safari unsupported and phones desktop-only", () => {
    expect(
      detectBrowser({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      }),
    ).toEqual({ browser: "unknown", mobile: false, unsupported: true });

    expect(
      detectBrowser({
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      }).mobile,
    ).toBe(true);
    expect(
      detectBrowser({ mobile: true, userAgent: CHROMIUM_BASE }).mobile,
    ).toBe(true);
  });
});

describe("extension catalog", () => {
  it("sends every Chromium browser to the one shared package", () => {
    const chromiumBrowsers = BROWSER_ORDER.filter((id) => id !== "firefox");
    for (const id of chromiumBrowsers) {
      expect(BROWSER_PROFILES[id].build).toBe("chromium");
      expect(extensionPackage(id)).toBe(EXTENSION_PACKAGES.chromium);
    }
    expect(extensionPackage("firefox")).toBe(EXTENSION_PACKAGES.firefox);
    expect(extensionPackage("unknown")).toBeUndefined();
  });

  it("never shows the word Chromium to the user", () => {
    for (const id of BROWSER_ORDER) {
      const profile = BROWSER_PROFILES[id];
      expect(profile.displayName).not.toMatch(/chromium/i);
      expect(profile.actionLabel).toContain(profile.displayName);
      for (const step of profile.steps) {
        expect(step).not.toMatch(/chromium/i);
      }
    }
  });

  it("points each browser at its own extensions page", () => {
    expect(BROWSER_PROFILES.chrome.extensionsUrl).toBe("chrome://extensions");
    expect(BROWSER_PROFILES.edge.extensionsUrl).toBe("edge://extensions");
    expect(BROWSER_PROFILES.brave.extensionsUrl).toBe("brave://extensions");
    expect(BROWSER_PROFILES.opera.extensionsUrl).toBe("opera://extensions");
    expect(BROWSER_PROFILES["opera-gx"].extensionsUrl).toBe(
      "opera://extensions",
    );
    expect(BROWSER_PROFILES.firefox.extensionsUrl).toBe(
      "about:debugging#/runtime/this-firefox",
    );

    for (const id of BROWSER_ORDER) {
      const profile = BROWSER_PROFILES[id];
      expect(profile.steps.join(" ")).toContain(profile.extensionsUrl);
    }
  });

  it("tells Chromium users to extract the ZIP before loading it", () => {
    for (const id of BROWSER_ORDER) {
      if (BROWSER_PROFILES[id].build !== "chromium") continue;
      const steps = BROWSER_PROFILES[id].steps.join(" ");
      expect(steps).toContain("Extract All");
      expect(steps).toContain("Do not select the ZIP");
      expect(steps).toContain("extracted folder containing manifest.json");
    }
  });

  it("labels the Firefox package as the unsigned development build", () => {
    // A signed .xpi would be a permanent install; this one is not, and the
    // file name must not pretend otherwise.
    expect(EXTENSION_PACKAGES.firefox.filename).toBe(
      "val-checker-firefox-extension-unsigned.zip",
    );
    expect(EXTENSION_PACKAGES.firefox.filename).not.toMatch(/\.xpi$/);
    expect(EXTENSION_PACKAGES.chromium.filename).toBe(
      "val-checker-chromium-extension.zip",
    );
  });
});
