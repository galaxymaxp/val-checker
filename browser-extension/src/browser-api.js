// Minimal WebExtension compatibility layer.
//
// Chromium exposes `chrome` and returns promises from Manifest V3 APIs.
// Firefox exposes the same surface as `browser` with promises, and also keeps a
// `chrome` alias. Resolving one namespace here keeps every caller identical, so
// the Riot connection implementation stays shared between both builds.
//
// Content scripts cannot import modules, so they repeat the one-line namespace
// pickup instead of importing this file. Everything with real behaviour lives
// here.
export const browserApi = globalThis.browser ?? globalThis.chrome;

/**
 * Hosts the background worker must reach to complete a Riot connection.
 * Firefox treats Manifest V3 host permissions as opt-in, so a user can install
 * the add-on and still withhold them. Chromium grants them at install time and
 * this check simply passes.
 */
export const REQUIRED_HOST_PERMISSIONS = [
  "https://auth.riotgames.com/*",
  "https://*.riotgames.com/*",
  "https://playvalorant.com/*",
];

export async function hasRiotHostAccess() {
  if (typeof browserApi.permissions?.contains !== "function") {
    return true;
  }

  try {
    return await browserApi.permissions.contains({
      origins: REQUIRED_HOST_PERMISSIONS,
    });
  } catch {
    // An older engine without origin introspection still enforces the manifest.
    return true;
  }
}
