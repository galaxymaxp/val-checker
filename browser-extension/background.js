import { classifyRiotAuthCallback } from "./auth-callback.js";

const APP_ORIGIN = "https://val-checker-three.vercel.app";
const CONNECT_API = `${APP_ORIGIN}/api/desktop/connect`;
const RIOT_AUTH_URL =
  "https://auth.riotgames.com/authorize" +
  "?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in" +
  "&client_id=play-valorant-web-prod" +
  "&response_type=token%20id_token&nonce=1&scope=account%20openid";
const JOB_TTL_MS = 5 * 60 * 1000;
const JOBS_KEY = "riotConnectJobs";
const ALARM_PREFIX = "riot-connect:";
const SESSION_PROOF_COOKIE_NAMES = new Set([
  "ssid",
  "clid",
  "csid",
  "sub",
  "asid",
  "did",
]);
const processingTabs = new Set();

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validStartPayload(value) {
  return (
    isRecord(value) &&
    typeof value.requestId === "string" &&
    value.requestId.length >= 16 &&
    value.requestId.length <= 128 &&
    typeof value.token === "string" &&
    value.token.length >= 32 &&
    value.token.length <= 128 &&
    (value.region === undefined || typeof value.region === "string") &&
    (value.label === undefined || typeof value.label === "string") &&
    (value.connectionId === undefined || typeof value.connectionId === "string")
  );
}

function normalizeSameSite(value) {
  switch (value) {
    case "strict":
      return "strict";
    case "lax":
      return "lax";
    case "no_restriction":
      return "no_restriction";
    default:
      return undefined;
  }
}

function toCanonicalCookie(cookie) {
  const mapped = {
    domain: cookie.domain,
    hostOnly: cookie.hostOnly,
    httpOnly: cookie.httpOnly,
    name: cookie.name,
    path: cookie.path || "/",
    secure: cookie.secure,
    value: cookie.value,
  };
  if (typeof cookie.expirationDate === "number") {
    mapped.expires = cookie.expirationDate;
  }
  const sameSite = normalizeSameSite(cookie.sameSite);
  if (sameSite) {
    mapped.sameSite = sameSite;
  }
  return mapped;
}

async function readJobs() {
  const stored = await chrome.storage.session.get(JOBS_KEY);
  return isRecord(stored[JOBS_KEY]) ? stored[JOBS_KEY] : {};
}

async function writeJobs(jobs) {
  await chrome.storage.session.set({ [JOBS_KEY]: jobs });
}

async function findJobByRiotTab(tabId) {
  const jobs = await readJobs();
  for (const [requestId, job] of Object.entries(jobs)) {
    if (isRecord(job) && job.riotTabId === tabId) {
      return { job, jobs, requestId };
    }
  }
  return null;
}

async function notifyResult(job, requestId, ok, reason) {
  try {
    await chrome.tabs.sendMessage(job.originTabId, {
      ok,
      reason,
      requestId,
      type: "VAL_CHECKER_RIOT_CONNECT_RESULT",
    });
  } catch {
    // The originating VAL Checker tab may have been closed.
  }
}

async function removeJob(requestId, jobs) {
  delete jobs[requestId];
  await writeJobs(jobs);
  await chrome.alarms.clear(`${ALARM_PREFIX}${requestId}`);
}

async function finishJob(requestId, job, jobs, ok, reason) {
  await removeJob(requestId, jobs);
  await notifyResult(job, requestId, ok, reason);
  try {
    await chrome.tabs.remove(job.riotTabId);
  } catch {
    // The Riot tab may already have been closed by the user.
  }
  try {
    await chrome.tabs.update(job.originTabId, { active: true });
  } catch {
    // Returning focus is convenience only.
  }
}

async function captureAndSubmit(requestId, job, jobs) {
  let cookies;
  try {
    cookies = await chrome.cookies.getAll({ domain: "riotgames.com" });
  } catch {
    await finishJob(requestId, job, jobs, false, "capture-failed");
    return;
  }

  const riotCookies = cookies.filter((cookie) => {
    const domain = cookie.domain.replace(/^\./, "");
    return domain === "riotgames.com" || domain.endsWith(".riotgames.com");
  });
  const hasSessionProof = riotCookies.some((cookie) =>
    SESSION_PROOF_COOKIE_NAMES.has(cookie.name),
  );
  if (!hasSessionProof) {
    await finishJob(requestId, job, jobs, false, "capture-failed");
    return;
  }

  const submission = {
    connectionId: job.connectionId,
    jar: JSON.stringify(riotCookies.map(toCanonicalCookie)),
    label: job.label,
    region: job.region,
    token: job.token,
  };

  try {
    const response = await fetch(CONNECT_API, {
      body: JSON.stringify(submission),
      cache: "no-store",
      credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      method: "POST",
      redirect: "error",
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !isRecord(result) || result.ok !== true) {
      await finishJob(
        requestId,
        job,
        jobs,
        false,
        response.status === 401 ? "expired" : "connect-failed",
      );
      return;
    }
  } catch {
    await finishJob(requestId, job, jobs, false, "connect-failed");
    return;
  }

  await finishJob(requestId, job, jobs, true);
}

async function handleRiotCallback(tabId, outcome) {
  if (
    (outcome !== "completed" && outcome !== "denied") ||
    processingTabs.has(tabId)
  ) {
    return;
  }

  processingTabs.add(tabId);
  try {
    const match = await findJobByRiotTab(tabId);
    if (!match) return;
    if (outcome === "denied") {
      await finishJob(match.requestId, match.job, match.jobs, false, "denied");
      return;
    }
    await captureAndSubmit(match.requestId, match.job, match.jobs);
  } finally {
    processingTabs.delete(tabId);
  }
}

async function startConnect(payload, sender) {
  if (
    !validStartPayload(payload) ||
    sender.tab?.id === undefined ||
    sender.tab.url === undefined ||
    !sender.tab.url.startsWith(`${APP_ORIGIN}/`)
  ) {
    return;
  }

  // Create the tab before navigating so the owner-bound job exists even when
  // an existing Riot session redirects to the callback immediately.
  const riotTab = await chrome.tabs.create({
    active: true,
    openerTabId: sender.tab.id,
    url: "about:blank",
  });
  if (riotTab.id === undefined) {
    await notifyResult(
      { originTabId: sender.tab.id },
      payload.requestId,
      false,
      "open-failed",
    );
    return;
  }

  const jobs = await readJobs();
  jobs[payload.requestId] = {
    connectionId: payload.connectionId,
    deadline: Date.now() + JOB_TTL_MS,
    label: payload.label,
    originTabId: sender.tab.id,
    region: payload.region,
    riotTabId: riotTab.id,
    token: payload.token,
  };
  await writeJobs(jobs);
  await chrome.alarms.create(`${ALARM_PREFIX}${payload.requestId}`, {
    delayInMinutes: JOB_TTL_MS / 60_000,
  });

  try {
    await chrome.tabs.update(riotTab.id, { url: RIOT_AUTH_URL });
  } catch {
    await finishJob(
      payload.requestId,
      jobs[payload.requestId],
      jobs,
      false,
      "open-failed",
    );
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "VAL_CHECKER_RIOT_CONNECT_START") {
    void startConnect(message.payload, sender).catch(async () => {
      if (
        validStartPayload(message.payload) &&
        sender.tab?.id !== undefined
      ) {
        await notifyResult(
          { originTabId: sender.tab.id },
          message.payload.requestId,
          false,
          "open-failed",
        );
      }
    });
    return;
  }

  if (
    message?.type === "VAL_CHECKER_RIOT_CALLBACK_OBSERVED" &&
    sender.tab?.id !== undefined
  ) {
    // Reclassify the trusted tab URL in the worker. The callback content
    // script never forwards the fragment or any token material.
    const outcome = classifyRiotAuthCallback(sender.tab.url);
    if (outcome === message.outcome) {
      void handleRiotCallback(sender.tab.id, outcome);
    }
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url ?? tab.url;
  const outcome = classifyRiotAuthCallback(url);
  if (outcome) void handleRiotCallback(tabId, outcome);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void findJobByRiotTab(tabId).then(async (match) => {
    if (!match) return;
    await removeJob(match.requestId, match.jobs);
    await notifyResult(
      match.job,
      match.requestId,
      false,
      "cancelled",
    );
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const requestId = alarm.name.slice(ALARM_PREFIX.length);
  void readJobs().then(async (jobs) => {
    const job = jobs[requestId];
    if (!isRecord(job)) return;
    await finishJob(requestId, job, jobs, false, "expired");
  });
});
