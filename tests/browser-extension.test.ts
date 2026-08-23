import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { classifyRiotAuthCallback } from "../browser-extension/src/auth-callback.js";

const extensionRoot = join(process.cwd(), "browser-extension");
const sourceRoot = join(extensionRoot, "src");
const manifestRoot = join(extensionRoot, "manifests");

interface Manifest {
  readonly background?: {
    readonly scripts?: string[];
    readonly service_worker?: string;
    readonly type?: string;
  };
  readonly browser_specific_settings?: {
    readonly gecko?: { readonly id?: string };
  };
  readonly content_scripts?: Array<{ matches: string[]; js?: string[] }>;
  readonly host_permissions?: string[];
  readonly permissions?: string[];
  readonly version?: string;
}

async function manifest(name: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(manifestRoot, name), "utf8"));
}

describe("private Riot browser extension", () => {
  it("keeps permissions and page access narrowly scoped for both builds", async () => {
    const base = await manifest("base.json");

    expect(base.version).toBe("1.2.0");
    expect(base.permissions).toEqual(["alarms", "cookies", "storage"]);
    expect(base.permissions).not.toContain("tabs");
    expect(base.host_permissions).not.toContain("<all_urls>");
    expect(base.host_permissions).toContain(
      "https://val-checker-three.vercel.app/*",
    );
    expect(base.host_permissions).toContain("https://playvalorant.com/*");
    expect(base.content_scripts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          matches: ["https://val-checker-three.vercel.app/*"],
        }),
        expect.objectContaining({
          js: ["riot-callback.js"],
          matches: ["https://playvalorant.com/*"],
          run_at: "document_start",
        }),
      ]),
    );

    // Browser-specific files carry only the differences, never extra reach.
    for (const name of ["chromium.json", "firefox.json"]) {
      const overlay = await manifest(name);
      expect(overlay.permissions).toBeUndefined();
      expect(overlay.host_permissions).toBeUndefined();
      expect(overlay.content_scripts).toBeUndefined();
    }
  });

  it("gives each engine the background form it supports", async () => {
    const chromium = await manifest("chromium.json");
    const firefox = await manifest("firefox.json");

    expect(chromium.background?.service_worker).toBe("background.js");
    expect(chromium.background?.scripts).toBeUndefined();

    // Firefox has no Manifest V3 service worker; it runs an event page.
    expect(firefox.background?.scripts).toEqual(["background.js"]);
    expect(firefox.background?.service_worker).toBeUndefined();
    expect(firefox.background?.type).toBe("module");
    expect(firefox.browser_specific_settings?.gecko?.id).toBe(
      "riot-connect@val-checker.app",
    );
  });

  it("recognizes Riot callback URL variants even when the page renders a 404", () => {
    const secret = "raw-access-token-must-not-be-returned";

    expect(
      classifyRiotAuthCallback(
        `https://playvalorant.com/opt_in/#access_token=${secret}&token_type=Bearer`,
      ),
    ).toBe("completed");
    expect(
      classifyRiotAuthCallback(
        `https://playvalorant.com/en-us/opt_in/#access_token=${secret}`,
      ),
    ).toBe("completed");
    expect(
      classifyRiotAuthCallback(
        "https://playvalorant.com/en-us/opt_in/?error=access_denied",
      ),
    ).toBe("denied");

    expect(
      classifyRiotAuthCallback(
        `https://playvalorant.com.evil.test/opt_in/#access_token=${secret}`,
      ),
    ).toBeNull();
    expect(
      classifyRiotAuthCallback(
        `https://playvalorant.com/news/opt_in/#access_token=${secret}`,
      ),
    ).toBeNull();
    expect(
      classifyRiotAuthCallback(
        `http://playvalorant.com/opt_in/#access_token=${secret}`,
      ),
    ).toBeNull();
    expect(
      classifyRiotAuthCallback(
        `https://playvalorant.com/opt_in/?access_token=${secret}`,
      ),
    ).toBeNull();
  });

  it("submits from the background worker without exposing cookies to page code", async () => {
    const [background, content, callback, classifier, compat] =
      await Promise.all([
        readFile(join(sourceRoot, "background.js"), "utf8"),
        readFile(join(sourceRoot, "content.js"), "utf8"),
        readFile(join(sourceRoot, "riot-callback.js"), "utf8"),
        readFile(join(sourceRoot, "auth-callback.js"), "utf8"),
        readFile(join(sourceRoot, "browser-api.js"), "utf8"),
      ]);

    expect(background).toContain(
      'browserApi.cookies.getAll({ domain: "riotgames.com" })',
    );
    expect(background).toContain('credentials: "omit"');
    expect(background).toContain("browserApi.storage.session");
    expect(classifier).toContain('fragment.has("access_token")');
    const blankTab = background.indexOf('url: "about:blank"');
    const savedJob = background.indexOf("await writeJobs(jobs)", blankTab);
    const riotNavigation = background.indexOf(
      "await browserApi.tabs.update(riotTab.id",
      savedJob,
    );
    expect(blankTab).toBeGreaterThan(-1);
    expect(savedJob).toBeGreaterThan(blankTab);
    expect(riotNavigation).toBeGreaterThan(savedJob);
    expect(background).not.toContain("console.");
    expect(content).not.toContain("cookie");
    expect(content).not.toContain("password");
    expect(callback).not.toContain("window.postMessage");
    expect(callback).not.toContain("console.");
    expect(callback).not.toContain("location.href");

    // One shared implementation: no engine name is branched on outside the
    // namespace pickup itself.
    for (const source of [background, content, callback, classifier]) {
      expect(source).not.toMatch(/\bchrome\.[a-z]/);
    }
    expect(compat).toContain("globalThis.browser ?? globalThis.chrome");
  });

  it("stops a Firefox connect attempt that lacks Riot host access", async () => {
    const background = await readFile(
      join(sourceRoot, "background.js"),
      "utf8",
    );

    const check = background.indexOf("await hasRiotHostAccess()");
    const tabCreate = background.indexOf("browserApi.tabs.create");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(tabCreate);
    expect(background).toContain('"permissions-needed"');
  });
});
