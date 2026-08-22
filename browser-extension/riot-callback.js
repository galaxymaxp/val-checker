// This content script runs on Riot's callback page even when the page itself
// renders a 404. It sends only a safe outcome; the URL fragment and tokens
// never leave the extension's trusted context.
function callbackOutcome() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  const locale = /^[a-z]{2}(?:-[a-z]{2})?$/i;
  const validPath =
    segments.at(-1)?.toLowerCase() === "opt_in" &&
    (segments.length === 1 ||
      (segments.length === 2 && locale.test(segments[0])));
  if (
    window.location.protocol !== "https:" ||
    window.location.hostname !== "playvalorant.com" ||
    !validPath
  ) {
    return null;
  }

  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (
    fragment.has("error") ||
    new URLSearchParams(window.location.search).has("error")
  ) {
    return "denied";
  }
  return fragment.has("access_token") && fragment.get("access_token") !== ""
    ? "completed"
    : null;
}

const outcome = callbackOutcome();
if (outcome) {
  void chrome.runtime
    .sendMessage({ outcome, type: "VAL_CHECKER_RIOT_CALLBACK_OBSERVED" })
    .catch(() => {
      // The extension may have been reloaded while this page was open.
    });
}
