# Security threat model

## Current safety posture

Phase 5 may be developed with fixtures, injected boundaries, and local tests. The Riot credential **ship gate remains closed**: VAL Checker must not accept, store, use, or deploy functionality that handles real Riot credentials or session material until the durability spike has shown no failure resembling Riot enforcement or abuse detection. This restriction is separate from normal public website signup, which remains available.

The current Riot connection UI cannot accept real session material. Its connect path is fixture/test-only, QR authentication is an explicit unsupported stub, and tests must not make Riot network requests. Connect eligibility is controlled by an explicit server-only allowlist of verified Supabase user IDs and emails. Empty or malformed configuration fails closed; a client-visible eligibility flag is presentation only, and the connection service enforces the allowlist again before capture or storage. Public signup and Riot-independent features are not allowlisted.

## Assets and trust boundaries

- Riot cookie/session account-access material is highly sensitive because it can permit account access while valid.
- Supabase stores encrypted session ciphertext, a unique nonce, and an encryption-key version. It must never store encryption key material.
- Encryption keys come only from the application server's runtime secret configuration. They are a separate trust domain from Supabase.
- The application server is the only component allowed to decrypt stored session material.
- Fixture and test inputs are untrusted data even when they are checked into the repository.

## Threats and controls

### Stored Riot session material and database compromise

Session material is encrypted with AES-256-GCM before storage. Each encryption uses a cryptographically secure, unique nonce. A database-only attacker can obtain ciphertext, nonce, key version, user identifiers, and lifecycle metadata, but not the runtime encryption keys. Encryption reduces the impact of a database-only compromise; it does not hide metadata or prevent deletion and corruption.

### Application or server compromise

A compromised application server can access runtime keys and plaintext during legitimate processing. Encryption at rest cannot protect against an attacker who controls both the application process and database access. Limit runtime secret access, keep dependencies patched, minimize plaintext lifetime, and investigate any server compromise as a potential Riot-session compromise.

### Encryption key compromise and rotation

Runtime keys must be supplied through environment or runtime secret configuration and must remain outside Supabase, source control, logs, test snapshots, and telemetry. Ciphertext records include an explicit key version. New writes use the configured current version, while old versions may remain available only as long as needed to decrypt and re-encrypt older records. Compromise of a key exposes every still-retained ciphertext encrypted under that version; rotate it, re-encrypt affected records, revoke affected Riot sessions, and remove the old key after migration.

### Cross-user ciphertext substitution

The authenticated user's `user_id` is passed to AES-GCM as authenticated additional data (AAD). This cryptographically binds a ciphertext to its owner without putting the identifier inside the plaintext. Moving one user's ciphertext to another user's row therefore causes authentication to fail. Database authorization and row-level security remain required; AAD is defense in depth, not a replacement for access control.

### Unauthorized connection attempts

Every working connection service entry point requires an explicit allowlist and
checks the verified Supabase user ID or email before reading fixture material or
writing storage. Runtime configuration contains comma-separated IDs and emails;
no configured entries means no account can connect, and malformed entries reject
the configuration rather than applying a partial list. Email matching is
case-normalized, user ID matching is exact after UUID normalization, and neither
client input nor `user_metadata` is trusted for authorization. Removing a user
from the allowlist blocks future connects but never blocks disconnect and local
deletion.

### Leaked logs, exceptions, and telemetry

Logs, exception messages, test names, assertion messages, snapshots, and telemetry must not include plaintext sessions, cookies, jars, access tokens, ID tokens, Authorization headers, encryption keys, ciphertext-derived plaintext, or user-provided credential values. Encryption and provider failures use generic messages. Operational diagnostics should record only safe categories, versions, and correlation identifiers.

### Malicious or compromised fixtures and test data

Fixtures can contain malformed, oversized, or adversarial data. Parse and validate them at boundaries, keep providers fixture-only, and never treat a fixture as authorization to make network requests. `fixtures/storefront-real.json` is the authoritative scrubbed storefront fixture; unknown schema questions are documented rather than filled with invented storefront fixtures. Test session bytes are randomly generated non-credential data and must never be replaced with captured real sessions.

### Session revocation and expiry

Confirmed session death must stop further checks and disconnect the Riot account. Ambiguous failures must not be treated as confirmed expiry. Users can disconnect to delete stored material, and the UI explains that Riot's **Sign out everywhere** control can invalidate existing sessions. Application deletion cannot guarantee Riot-side revocation, so users should use that Riot control when immediate invalidation matters.

### Riot enforcement and abuse detection

The external durability spike is an abuse-detection canary, not a development prerequisite. The ship gate remains closed until the spike has not failed in a way that resembles Riot enforcement or abuse detection. A passing canary reduces one observed risk but does not prove future compatibility, policy compliance, or safety from Riot-side changes.

## Residual risk and limitations

- AES-GCM protects stored content, not access patterns, row metadata, availability, or a server compromised while keys are loaded.
- Key rotation limits future exposure but cannot undo access that occurred before rotation.
- AAD prevents undetected cross-user substitution only when the application supplies the correct authenticated user identifier.
- Disconnecting from VAL Checker deletes local storage but does not itself revoke Riot-side sessions.
- The durability spike is evidence from a limited observation window, not a guarantee against later enforcement or protocol changes.
- The connect allowlist limits who can enter the fixture-only flow; it does not make real credential handling safe or open the ship gate.
- The unavailable lifecycle v2.1 detail has been superseded by an explicit project decision: `OK` resets the counter, `DEAD` disconnects immediately without being counted, `UNKNOWN` and `ERROR` increment it, and a count greater than or equal to 3 requires reauthentication. This reduces ambiguity but does not make ambiguous failures authoritative evidence of session death.

Please report suspected vulnerabilities privately to the repository owner. Do not include real Riot credentials, cookies, tokens, session material, or encryption keys in a report.
