import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const extensionRoot = join(process.cwd(), "browser-extension");

describe("private Riot browser extension", () => {
  it("keeps permissions and page access narrowly scoped", async () => {
    const manifest = JSON.parse(
      await readFile(join(extensionRoot, "manifest.json"), "utf8"),
    ) as {
      host_permissions: string[];
      permissions: string[];
      content_scripts: Array<{ matches: string[] }>;
    };

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
    expect(manifest.content_scripts).toEqual([
      expect.objectContaining({
        matches: ["https://val-checker-three.vercel.app/*"],
      }),
    ]);
  });

  it("submits from the background worker without exposing cookies to page code", async () => {
    const [background, content] = await Promise.all([
      readFile(join(extensionRoot, "background.js"), "utf8"),
      readFile(join(extensionRoot, "content.js"), "utf8"),
    ]);

    expect(background).toContain('chrome.cookies.getAll({ domain: "riotgames.com" })');
    expect(background).toContain('credentials: "omit"');
    expect(background).toContain("chrome.storage.session");
    expect(background).toContain("access_token=");
    expect(background).not.toContain("console.");
    expect(content).not.toContain("cookie");
    expect(content).not.toContain("password");
  });
});
