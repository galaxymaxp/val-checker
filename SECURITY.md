# Security threat model

## Current safety posture

Phase 6 is open for single-user dogfooding. The retired 14-day durability gate
has been superseded by a staged rollout: operate only the owner's account for
approximately three weeks, then add users individually to the Riot connection
allowlist. This does not restrict normal public magic-link signup, catalog
browsing, or watchlists.

The connect path accepts Riot session material only from an identity authorized
by the explicit server-only allowlist of verified Supabase user IDs and emails.
It checks authorization before processing credentials or a submitted jar,
requires consent, validates bounded input, and encrypts the resulting session.
Credential sign-in and the administrator-only submitted-jar fallback contact
Riot's authentication and user-info hosts before storage so the session is
bound to a stable PUUID; neither path fetches a storefront. Empty or malformed
allowlist configuration fails closed. A client-visible eligibility flag is
presentation only; the server repeats authorization at the trust boundary.
Public signup and Riot-independent features are not allowlisted.

Live storefront access is confined to the protected automatic worker and the
authenticated manual-refresh server action for allowlisted, connected accounts.
Database claims permit at most one automatic attempt per connection and one
separate manual storefront attempt per stable Riot PUUID in each UTC store day.
There is no polled, query-driven, or public debug request path to Riot.

## Assets and trust boundaries

- Riot cookie/session account-access material is highly sensitive because it can permit account access while valid.
- Supabase stores encrypted session ciphertext, a unique nonce, and an encryption-key version. It must never store encryption key material.
- Encryption keys come only from the application server's runtime secret configuration. They are a separate trust domain from Supabase.
- The application server is the only component allowed to decrypt stored session material.
- Submitted jars, fixtures, and test inputs are untrusted data even when they are checked into the repository.
- Resend receives the verified destination email and rendered notification content, but never Riot cookies, tokens, authorization headers, or PUUIDs.

## Threats and controls

### Stored Riot session material and database compromise

Server-side AES-256-GCM encryption is load-bearing, not optional hardening.
Email alerts require VAL Checker to retain the session instead of leaving it only
on the user's device. Each encryption uses a cryptographically secure, unique
nonce and binds the owner as AAD. A database-only attacker can obtain
ciphertext, nonce, key version, user identifiers, and lifecycle metadata, but
not the runtime encryption keys. Encryption reduces the impact of a
database-only compromise; it does not hide metadata or prevent deletion and
corruption.

### Application or server compromise

A compromised application server can access runtime keys and plaintext during legitimate processing. Encryption at rest cannot protect against an attacker who controls both the application process and database access. Limit runtime secret access, keep dependencies patched, minimize plaintext lifetime, and investigate any server compromise as a potential Riot-session compromise.

### Encryption key compromise and rotation

Runtime keys must be supplied through environment or runtime secret configuration and must remain outside Supabase, source control, logs, test snapshots, and telemetry. Ciphertext records include an explicit key version. New writes use the configured current version, while old versions may remain available only as long as needed to decrypt and re-encrypt older records. Compromise of a key exposes every still-retained ciphertext encrypted under that version; rotate it, re-encrypt affected records, revoke affected Riot sessions, and remove the old key after migration.

### Cross-user ciphertext substitution

The authenticated user's `user_id` is passed to AES-GCM as authenticated additional data (AAD). This cryptographically binds a ciphertext to its owner without putting the identifier inside the plaintext. Moving one user's ciphertext to another user's row therefore causes authentication to fail. Database authorization and row-level security remain required; AAD is defense in depth, not a replacement for access control.

### Unauthorized connection attempts

Every connection service entry point requires an explicit allowlist and checks
the verified Supabase user ID or email before processing submitted material or
writing storage. Runtime configuration contains comma-separated IDs and emails;
no configured entries means no account can connect, and malformed entries reject
the configuration rather than applying a partial list. Email matching is
case-normalized, user ID matching is exact after UUID normalization, and neither
client input nor `user_metadata` is trusted for authorization. Removing a user
from the allowlist blocks future connects but never blocks disconnect and local
deletion.

The daily worker repeats the allowlist check immediately before live Riot use.
An old encrypted row is not permission to keep checking an identity that is no
longer allowlisted.

### Riot request surface and cadence

The authenticated daily cron route enumerates eligible connections and invokes
the shared storefront worker. A database uniqueness claim enforces one
automatic attempt per connection and UTC store day even if the scheduler invokes
the route more than once. The cron secret authenticates the scheduler but does
not replace the per-connection claim or allowlist.

The manual-refresh server action accepts one validated connection UUID, verifies
that the signed-in user owns it, and then invokes the same worker with the
`manual` trigger. A service-only, token-fenced database claim keyed by stable
Riot PUUID serializes concurrent browsers and devices. A pre-storefront failure
can be reclaimed after its bounded lease; once a Riot storefront request starts,
the allowance is exhausted for that store day even if a later network or server
failure prevents success. This conservative exception to consume-on-success
prevents replaying an ambiguous request. Automatic and manual claims are
independent. Internal operator runs use the same worker and do not expose a
public route. Tests use injected fetch implementations and must remain offline.

Automatic, manual, and internal triggers additionally compete for one
owner/connection/epoch-fenced session-rotation lease before reauthentication.
Only its holder can persist rotated session material or cross a storefront
attempt fence. A pre-attempt lease can be reclaimed after five minutes; an
attempted lease left by a crashed process is not reclaimed until the next UTC
store day or an exact reconnect changes the epoch. Normal terminal paths release
the lease. This prevents two triggers from overwriting one another's rotated jar
or issuing concurrent storefront requests for the same connection.

### Leaked logs, exceptions, and telemetry

Logs, exception messages, test names, assertion messages, snapshots, and telemetry must not include plaintext sessions, cookies, jars, access tokens, ID tokens, Authorization headers, encryption keys, ciphertext-derived plaintext, or user-provided credential values. Encryption and provider failures use generic messages. Operational diagnostics should record only safe categories, versions, and correlation identifiers.

### Malicious submissions, fixtures, and test data

Submitted jars and fixtures can contain malformed, oversized, or adversarial
data. Authorize before parsing session submissions, enforce size and cookie-count
bounds, and validate at every external boundary. Never treat a fixture or a
successful connection as authorization for an ad-hoc network request.
`fixtures/storefront-real.json` is the authoritative scrubbed storefront
fixture; unknown schema questions are documented rather than filled with
invented fixtures. Test session bytes are non-credential data and must never be
replaced with captured real sessions.

### Session revocation and expiry

Confirmed session death must stop further checks, move the stored connection to
`REAUTH_REQUIRED`, and send the bounded expiry notice. Ambiguous failures are
counted but are not treated as authoritative death; the third consecutive
ambiguous failure also requires reconnection. Users can disconnect to delete
stored material, and the UI explains that Riot's **Sign out everywhere** control
can invalidate existing sessions. Application deletion cannot guarantee
Riot-side revocation, so users should use that Riot control when immediate
invalidation matters.

Every successful reauthentication can rotate cookies. The complete rotated jar
must be encrypted and persisted before a run can count as successful. A
persistence failure stops the run rather than continuing with an unrecorded
session state.

### Email deduplication

Storefront notifications are reserved atomically by user, skin, and UTC
rotation. Resend receives a deterministic idempotency key derived from the
durable notification ID, and `emailed_at` is written only after provider
acceptance. Provider or database errors are surfaced through generic messages
that do not include recipient addresses, provider details, or session material.

### Riot enforcement and abuse detection

The 14-day durability gate was retired after research found project-level DMCA
enforcement against store checkers rather than evidence of account-level bans.
The replacement control is staged exposure: operator-only dogfooding for
approximately three weeks, followed by individually allowlisted users. This
evidence and rollout limit do not prove future compatibility, policy compliance,
or safety from Riot-side changes, and they do not eliminate project-level legal
or availability risk.

## Residual risk and limitations

- AES-GCM protects stored content, not access patterns, row metadata, availability, or a server compromised while keys are loaded.
- Key rotation limits future exposure but cannot undo access that occurred before rotation.
- AAD prevents undetected cross-user substitution only when the application supplies the correct authenticated user identifier.
- Disconnecting from VAL Checker deletes local storage but does not itself revoke Riot-side sessions.
- The retired durability reasoning is preserved in the roadmap, but it is not a guarantee against later enforcement or protocol changes.
- The connect allowlist limits dogfooding scope; it does not make retained session material harmless or authorize public Riot access.
- The bounded maximum of one automatic attempt plus one manual attempt per Riot account and store day reduces the live request surface but cannot guarantee Riot availability or prevent protocol changes.
- The unavailable lifecycle v2.1 detail has been superseded by an explicit project decision: `OK` resets the counter, `DEAD` stops checks immediately and persists `REAUTH_REQUIRED` without incrementing the counter, `UNKNOWN` and `ERROR` increment it, and a count greater than or equal to 3 also requires reauthentication. This reduces ambiguity but does not make ambiguous failures authoritative evidence of session death.

Please report suspected vulnerabilities privately to the repository owner. Do not include real Riot credentials, cookies, tokens, session material, or encryption keys in a report.
