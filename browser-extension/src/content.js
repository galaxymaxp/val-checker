// Content scripts cannot import modules; see browser-api.js for the shared
// rationale behind this namespace pickup.
const browserApi = globalThis.browser ?? globalThis.chrome;

const WEB_SOURCE = "val-checker-web";
const EXTENSION_SOURCE = "val-checker-extension";

function announceReady() {
  window.postMessage(
    {
      source: EXTENSION_SOURCE,
      type: "VAL_CHECKER_EXTENSION_READY",
      version: browserApi.runtime.getManifest().version,
    },
    window.location.origin,
  );
}

window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    event.data?.source !== WEB_SOURCE
  ) {
    return;
  }

  if (event.data.type === "VAL_CHECKER_EXTENSION_PING") {
    announceReady();
    return;
  }

  if (event.data.type !== "VAL_CHECKER_RIOT_CONNECT_START") {
    return;
  }

  void browserApi.runtime
    .sendMessage({
      payload: event.data.payload,
      type: "VAL_CHECKER_RIOT_CONNECT_START",
    })
    .catch(() => {
      window.postMessage(
        {
          ok: false,
          reason: "open-failed",
          requestId: event.data.payload?.requestId,
          source: EXTENSION_SOURCE,
          type: "VAL_CHECKER_RIOT_CONNECT_RESULT",
        },
        window.location.origin,
      );
    });
});

browserApi.runtime.onMessage.addListener((message) => {
  if (message?.type !== "VAL_CHECKER_RIOT_CONNECT_RESULT") {
    return;
  }

  window.postMessage(
    {
      ok: message.ok === true,
      reason: typeof message.reason === "string" ? message.reason : undefined,
      requestId: message.requestId,
      source: EXTENSION_SOURCE,
      type: "VAL_CHECKER_RIOT_CONNECT_RESULT",
    },
    window.location.origin,
  );
});

announceReady();
