# Temporary Riot cloud-browser architecture

## Status and success gate

The repository now contains a canary-ready implementation, not a proven
migration. A successful build or Chromium launch is insufficient. Electron and
the direct Riot credential exchange remain rollback paths until a real canary
completes this whole sequence:

1. A phone or desktop browser starts an owner-bound temporary session.
2. The user completes Riot's real login, including interactive MFA/CAPTCHA when
   presented.
3. The full useful cookie jar is captured and normalized.
4. Existing Riot reauthentication resolves PUUID, Riot ID, tag, and region.
5. The jar is encrypted and stored by the existing session store.
6. The existing worker retrieves a personalized storefront.
7. The temporary browser is destroyed.
8. After normal play from the Philippines and a meaningful delay, a later
   worker run reauthenticates from the stored jar, persists rotated cookies, and
   retrieves the storefront again.

Only after step 8 is evidenced should `desktop/`, Electron dependencies and
pairing routes, and the obsolete direct username/password flow be deleted.
Manual cookie JSON remains permanently as the advanced fallback.

## Existing architecture discovered

Before this change, Electron captured cookies from a real Riot page and posted
them with a one-time pairing token. Manual JSON and direct-credential providers
also produced a `CapturedSession`. The shared connection service normalized and
validated the jar, resolved Riot identity through reauthentication and
`/userinfo`, and stored the complete jar encrypted with AES-256-GCM and owner ID
as AAD. The worker decrypted under a serialized lease, minted short-lived Riot
tokens, persisted every `Set-Cookie` rotation before storefront access, and
classified deterministic dead versus ambiguous failures. The protected daily
cron invokes that worker. These reusable pieces remain intact.

## Implemented architecture

```text
user browser
  -> authenticated Vercel route (sin1)
  -> owner-bound Supabase control row (Tokyo)
  -> CloudBrowserService HTTP boundary
  -> isolated Chromium service (Singapore)
  -> CloudBrowserSessionProvider / CapturedSession
  -> existing connection service + encryption/storage
  -> existing storefront worker + rotated-cookie persistence
  -> browser destruction
```

The Next.js app is the control plane. `CloudBrowserService` is a replaceable
interface for create, status, stream, cookie capture, and idempotent destroy.
The first data-plane implementation is a small standalone Node/Playwright
service using Chrome DevTools Protocol screencasting over an authenticated
WebSocket. Pointer coordinates are normalized in the viewer and mapped to the
per-session viewport; a hidden mobile textarea forwards soft-keyboard text.

Each session has a separate Chromium process and incognito context. The service
has no persistent browser profile and keeps its session map only in memory. It
does not log inputs, screenshots, URLs, response bodies, cookies, tokens, MFA
codes, or CAPTCHA contents. A 30-second disconnect grace handles mobile radio
handoffs; sustained disconnect, expiry, cancellation, success, or failure
destroys the browser.

## Database and authorization

`20260821074913_riot_cloud_connection_sessions.sql` adds an acquisition provider
to existing Riot connections and one small temporary-session table. Temporary
rows contain owner, safe state, timestamps, region/label, non-secret diagnostic
booleans, and a server-only provider ID. They contain no password, MFA code,
cookie, access/entitlement token, screenshot, or stream bearer token.

The table has RLS, an owner-only SELECT policy, column-limited authenticated
grants that omit the provider ID, and service-role mutation access. Application
routes independently derive verified Supabase claims and scope every read,
update, cancellation, and atomic capture claim by both session ID and owner.
Sessions expire after eight minutes and can be consumed once.

## Hosting and regions

Vercel remains the web/function control plane and is pinned to one `sin1`
region. The existing `/api/cron/storefront` schedule remains `5 0 * * *`.
Supabase stays in `ap-northeast-1` (Tokyo).

Vercel Functions are not the browser host: an interactive Chromium session
needs a long-lived bidirectional transport, while Vercel Functions cannot act
as WebSocket servers and function duration/bundle constraints make lifecycle
ownership brittle. The canary data plane targets Cloud Run
`asia-southeast1` (Singapore), with 2 GiB memory, one vCPU, ten-minute request
timeout, and `max-instances=1`. See `cloud-browser/README.md` for the exact
command. Single-instance routing is required by the prototype's in-memory map.

The viewer endpoint is public only so ordinary browsers can load it; the random
fragment token authenticates the WebSocket and never appears in the HTTP
request. Control endpoints require a separate API key. Production deployment
must use HTTPS, a secret-manager-backed high-entropy key, restricted operator
access, and logging/telemetry review before enabling the flag.

## Rollout controls and UX

- `RIOT_CLOUD_CONNECT_ENABLED=false` is the emergency kill switch and default.
- With the feature enabled and `RIOT_CLOUD_CONNECT_PUBLIC=false`, the existing
  verified user/email allowlist is the canary cohort.
- `RIOT_CLOUD_CONNECT_PUBLIC=true` removes the hard allowlist dependency only
  for cloud connection; the kill switch remains.
- Manual JSON remains visible under advanced connection options and still uses
  existing structure/size limits, normalization, encryption, and lifecycle.
- The connection view is responsive for 375×667, 390×844, and 430×932-class
  phones, as well as tablet/desktop browsers. Errors, rejection, and expiry
  offer retry and manual fallback rather than an endless spinner.

The accurate user promise is: the user signs in on Riot Games' actual page in a
temporary isolated browser, and VAL Checker does not store the Riot password.
The infrastructure necessarily carries keyboard events, so it must not claim it
cannot see the password.

## Canary procedure

1. Review and apply the migration through the project's reconciled Supabase
   migration process; run hosted database security/performance advisors.
2. Deploy `cloud-browser/` to Cloud Run `asia-southeast1` with the documented
   single-instance settings and secrets. Confirm health without recording a
   viewer URL.
3. Configure the Vercel preview deployment with the browser HTTPS origin/API
   key, `RIOT_CLOUD_CONNECT_ENABLED=true`, `RIOT_CLOUD_CONNECT_PUBLIC=false`,
   and only the operator in the allowlist. Confirm the deployment runs in
   `sin1` and Supabase remains Tokyo.
4. From iPhone Safari, Android Chrome, and a desktop browser, verify touch,
   scaling, soft/hardware keyboard, reconnect behavior, MFA, and CAPTCHA when
   Riot presents them. Never capture screens or input in logs.
5. Verify safe control metadata: login observed, MFA/CAPTCHA booleans,
   validation/storefront success, consumed timestamp, and destroyed timestamp.
   Confirm no secrets appear in browser network responses, database rows,
   Vercel/Cloud Run logs, or telemetry.
6. Confirm the resolved PUUID/Riot ID/region and personalized storefront, and
   confirm the browser service no longer has the session.
7. Launch/play Riot normally from the Philippines. After a meaningful delay
   and preferably the next store rotation, run the normal protected worker.
   Verify `last_refresh_at`, the safe `riot_run_logs` classification/outcome,
   storefront persistence, and encrypted jar rotation. Record the later canary
   result; do not set `reauth_test_succeeded` based on the immediate validation
   run.
8. Exercise cancellation, eight-minute expiry, failed login, browser-service
   outage, repeated capture/status calls, and two simultaneous allowlisted users.
9. Keep the canary private for the agreed observation period. Only after the
   full later-reauth evidence is satisfactory remove Electron/direct credential
   code in a separate reviewed change, then consider public eligibility.

## Cost and residual risk

The Vercel side stays compatible with Hobby: one function region and the
existing daily cron; no multi-region or Pro-only configuration is introduced.
Cloud Run has a free tier, but active WebSocket/CPU/memory time and Singapore
egress can incur charges, so configure billing alerts and keep the feature
allowlisted/off by default. `max-instances=1` caps cost but also creates a single
point of failure and limited concurrency.

Riot sees the Singapore data-center IP, may challenge or reject it, and can
change private authentication/storefront behavior. CAPTCHAs may be difficult in
a screenshot stream. A provider restart loses in-memory sessions. Horizontal
scale needs external routing or per-session compute. The remote-browser service
is a high-value trust boundary because it transports pixels and keystrokes.
Future official RSO must not be assumed to grant private storefront access.
