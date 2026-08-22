import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { classifyRiotAuthCallback } from "../browser-extension/auth-callback.js";

const extensionRoot = join(process.cwd(), "browser-extension");

describe("private Riot browser extension", () => {
  it("keeps permissions and page access narrowly scoped", async () => {
    const manifest = JSON.parse(
      await readFile(join(extensionRoot, "manifest.json"), "utf8"),
    ) as {
      host_permissions: string[];
      permissions: string[];
      content_scripts: Array<{ matches: string[] }>;
      version: string;
    };

    expect(manifest.version).toBe("1.1.0");
    expect(manifest.permissions).toEqual([
      "alarms",
      "cookies",
      "storage",
    ]);
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.host_permissions).not.toContain("<all_urls>");
    expect(manifest.host_permissions).toContain(
      "https://val-checker-three.vercel.app/*",
    );
    expect(manifest.host_permissions).toContain("https://playvalorant.com/*");
    expect(manifest.content_scripts).toEqual(
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
    const [background, content, callback, classifier] = await Promise.all([
      readFile(join(extensionRoot, "background.js"), "utf8"),
      readFile(join(extensionRoot, "content.js"), "utf8"),
      readFile(join(extensionRoot, "riot-callback.js"), "utf8"),
      readFile(join(extensionRoot, "auth-callback.js"), "utf8"),
    ]);

    expect(background).toContain('chrome.cookies.getAll({ domain: "riotgames.com" })');
    expect(background).toContain('credentials: "omit"');
    expect(background).toContain("chrome.storage.session");
    expect(classifier).toContain('fragment.has("access_token")');
    const blankTab = background.indexOf('url: "about:blank"');
    const savedJob = background.indexOf("await writeJobs(jobs)", blankTab);
    const riotNavigation = background.indexOf(
      "await chrome.tabs.update(riotTab.id",
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
  });
});
