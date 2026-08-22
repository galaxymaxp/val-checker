import { redirect } from "next/navigation";

import {
  connectRiotSession,
  createRiotCaptureToken,
  disconnectRiotSession,
} from "@/app/dashboard/riot-actions";
import { ConnectedRiotAccounts } from "@/app/dashboard/connected-riot-accounts";
import { RiotConnectionPanel } from "@/app/dashboard/riot-connection-panel";
import { isDevPreview } from "@/src/lib/dev/preview";
import { previewAccounts } from "@/src/lib/dev/preview-data";
import { canRiotConnect } from "@/src/lib/riot/connect-allowlist";
import { loadRiotAccountsWithClient } from "@/src/lib/riot/connection-state";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export default async function RiotConnectionPage({
  searchParams = Promise.resolve({}),
}: {
  readonly searchParams?: Promise<{ readonly reconnect?: string }>;
} = {}) {
  const preview = isDevPreview();
  const supabase = preview ? null : await createServerSupabaseClient();
  const { data } = preview
    ? { data: { claims: { email: undefined, sub: "preview-user" } } }
    : await supabase!.auth.getClaims();

  if (!data?.claims.sub) {
    redirect("/sign-in?next=/dashboard/connection");
  }

  const riotIdentity = {
    email:
      typeof data.claims.email === "string" ? data.claims.email : undefined,
    userId: data.claims.sub,
  };
  // Extension and cookie-JSON connection stay private: both the rendered
  // controls and the server actions independently enforce this allowlist.
  const riotConnectAllowed = preview || canRiotConnect(riotIdentity);

  const accounts = preview
    ? previewAccounts(new Date())
    : await loadRiotAccountsWithClient(
        createAdminSupabaseClient(),
        data.claims.sub,
      );
  const requestedReconnect = (await searchParams).reconnect;
  const reconnectAccount = accounts.find(
    (account) => account.id === requestedReconnect,
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">RIOT CONNECTION</p>
        <h1>
          {reconnectAccount
            ? `Reconnect ${reconnectAccount.label ?? "this Riot account"}.`
            : "Manage your Riot accounts."}
        </h1>
        <p className="lede">
          Each account keeps its own encrypted session, store history, and
          daily refresh allowance. This service is unaffiliated with Riot Games.
        </p>
      </header>
      <ConnectedRiotAccounts
        accounts={accounts}
        disconnect={disconnectRiotSession}
      />
      <RiotConnectionPanel
        cloudConnectAvailable={false}
        connectAllowed={riotConnectAllowed}
        createCaptureToken={
          riotConnectAllowed ? createRiotCaptureToken : undefined
        }
        connectSession={
          riotConnectAllowed ? connectRiotSession : undefined
        }
        initialLabel={reconnectAccount?.label ?? ""}
        initialRegion={reconnectAccount?.region ?? "ap"}
        initialState="disconnected"
        keepConnectFormOpen={!reconnectAccount}
        targetConnectionId={reconnectAccount?.id}
      />
    </main>
  );
}
