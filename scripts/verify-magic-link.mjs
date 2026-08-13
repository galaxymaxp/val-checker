import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const statusSchema = z.object({
  ANON_KEY: z.string().min(1),
  API_URL: z.url(),
  INBUCKET_URL: z.url(),
});

const root = process.cwd();
const appUrl = process.env.AUTH_VERIFY_APP_URL ?? "http://127.0.0.1:3000";
const environment = { ...process.env };

if (process.platform === "win32" && environment.LOCALAPPDATA) {
  const dockerBin = path.join(
    environment.LOCALAPPDATA,
    "Programs",
    "DockerDesktop",
    "resources",
    "bin",
  );
  environment.PATH = `${dockerBin}${path.delimiter}${environment.PATH ?? ""}`;
}

function fail(message) {
  throw new Error(`Magic-link verification failed: ${message}`);
}

function readLocalStatus() {
  try {
    const cli = path.join(root, "node_modules", "supabase", "dist", "supabase.js");
    const output = execFileSync(
      process.execPath,
      [cli, "--workdir", root, "status", "-o", "json"],
      {
        cwd: root,
        encoding: "utf8",
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return statusSchema.parse(JSON.parse(output));
  } catch {
    fail("the local Supabase stack is unavailable.");
  }
}

async function fetchLatestMessage(inbucketUrl, email) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const query = new URLSearchParams({ query: `to:${email}` });
    const response = await fetch(
      `${inbucketUrl}/view/latest.html?${query}`,
    );

    if (response.ok) {
      return response.text();
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  fail("the local sign-in email did not arrive.");
}

function extractMagicLink(html) {
  const match = html.match(/href="([^"]+)"/i);
  if (!match?.[1]) {
    fail("the local sign-in email did not contain a link.");
  }

  return match[1].replaceAll("&amp;", "&");
}

function responseCookies(response) {
  const cookies = response.headers.getSetCookie().map((header) => header.split(";", 1)[0]);
  if (cookies.length === 0) {
    fail("the auth callback did not establish a session.");
  }
  return cookies.join("; ");
}

const status = readLocalStatus();
const unauthenticated = await fetch(`${appUrl}/dashboard`, { redirect: "manual" });
if (unauthenticated.status !== 307) {
  fail("an unauthenticated dashboard request was not redirected.");
}

const identity = randomUUID();
const mailbox = `magic-${identity}`;
const email = `${mailbox}@example.test`;
const supabase = createClient(status.API_URL, status.ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});
const { error } = await supabase.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: `${appUrl}/auth/confirm?next=/dashboard`,
  },
});

if (error) {
  fail("the local auth service rejected the sign-in request.");
}

const message = await fetchLatestMessage(status.INBUCKET_URL, email);
const callback = await fetch(extractMagicLink(message), { redirect: "manual" });
const callbackLocation = callback.headers.get("location");
if (callback.status !== 307 || !callbackLocation) {
  fail("the one-time link did not return a redirect.");
}
if (new URL(callbackLocation).pathname !== "/dashboard") {
  fail("the auth service rejected the one-time link.");
}

const dashboard = await fetch(`${appUrl}/dashboard`, {
  headers: { cookie: responseCookies(callback) },
  redirect: "manual",
});
const dashboardBody = await dashboard.text();
if (dashboard.status !== 200 || !dashboardBody.includes("Your dashboard is ready.")) {
  fail("the authenticated dashboard did not render.");
}

console.log("Magic-link sign-in and protected dashboard verification passed.");
