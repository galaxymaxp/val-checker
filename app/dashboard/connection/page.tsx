import { redirect } from "next/navigation";

import {
  connectRiotCredentials,
  connectRiotSession,
  disconnectRiotSession,
  submitRiotMfaCode,
} from "@/app/dashboard/riot-actions";
import { ConnectedRiotAccounts } from "@/app/dashboard/connected-riot-accounts";
import { RiotConnectionPanel } from "@/app/dashboard/riot-connection-panel";
import { canRiotConnect, isRiotAdmin } from "@/src/lib/riot/connect-allowlist";
import { loadRiotAccountsWithClient } from "@/src/lib/riot/connection-state";
import { createAdminSupabaseClient } from "@/src/lib/supabase/server-admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export default async function RiotConnectionPage({
  searchParams = Promise.resolve({}),
}: {
  readonly searchParams?: Promise<{ readonly reconnect?: string }>;
} = {}) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims.sub) {
    redirect("/sign-in?next=/dashboard/connection");
  }

  const riotIdentity = {
    email:
      typeof data.claims.email === "string" ? data.claims.email : undefined,
    userId: data.claims.sub,
  };
  const riotConnectAllowed = canRiotConnect(riotIdentity);
  // The raw cookie-jar paste is an admin-only fallback (Version 2.4).
  const riotJarPasteAllowed = riotConnectAllowed && isRiotAdmin(riotIdentity);

  const accounts = await loadRiotAccountsWithClient(
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
        connectAllowed={riotConnectAllowed}
        connectCredentials={
          riotConnectAllowed ? connectRiotCredentials : undefined
        }
        connectSession={riotJarPasteAllowed ? connectRiotSession : undefined}
        initialLabel={reconnectAccount?.label ?? ""}
        initialRegion={reconnectAccount?.region ?? "ap"}
        initialState="disconnected"
        keepConnectFormOpen={!reconnectAccount}
        submitMfaCode={riotConnectAllowed ? submitRiotMfaCode : undefined}
        targetConnectionId={reconnectAccount?.id}
      />
    </main>
  );
}
