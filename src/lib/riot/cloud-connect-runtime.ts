import "server-only";

import { HttpCloudBrowserService } from "@/src/lib/riot/cloud-browser-service";
import { CloudConnectController } from "@/src/lib/riot/cloud-connect-controller";
import { SupabaseCloudConnectionStore } from "@/src/lib/riot/cloud-connection-store";
import { assertRiotCloudConnectAllowed } from "@/src/lib/riot/cloud-connect-policy";
import type { RiotConnectIdentity } from "@/src/lib/riot/connect-allowlist";
import { RiotConnectionService } from "@/src/lib/riot/connection-service";
import { ManualCookieProvider, SubmittedCookieProvider } from "@/src/lib/riot/session-provider";
import { AesGcmSessionCipher, loadSessionKeyring } from "@/src/lib/riot/session-crypto";
import { LiveRiotSessionIdentityResolver } from "@/src/lib/riot/session-identity";
import { SupabaseEncryptedSessionStore } from "@/src/lib/riot/session-store";
import { createTlsTunedFetch } from "@/src/lib/riot/tls-fetch";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { runConnectStorefrontFetchForConnection } from "@/src/lib/worker/on-demand-check";

export function buildCloudConnectController(identity: RiotConnectIdentity) {
  assertRiotCloudConnectAllowed(identity);
  const admin = createAdminSupabaseClient();
  const cipher = new AesGcmSessionCipher(loadSessionKeyring());
  const authorizer = {
    assertAllowed(candidate: RiotConnectIdentity): void {
      assertRiotCloudConnectAllowed(candidate);
    },
  };
  const connection = new RiotConnectionService(
    new ManualCookieProvider(),
    new SupabaseEncryptedSessionStore(admin, cipher),
    authorizer,
    new SubmittedCookieProvider(),
    undefined,
    undefined,
    new LiveRiotSessionIdentityResolver(createTlsTunedFetch()),
  );
  return new CloudConnectController(
    new SupabaseCloudConnectionStore(admin),
    new HttpCloudBrowserService(),
    connection,
    runConnectStorefrontFetchForConnection,
  );
}
