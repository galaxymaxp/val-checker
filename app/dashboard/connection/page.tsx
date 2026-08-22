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
        <p className="eyebrow">RIOT ACCOUNTS</p>
        <h1>
          {reconnectAccount
            ? `Reconnect ${reconnectAccount.label ?? "this Riot account"}.`
            : "Your Riot accounts."}
        </h1>
        <p className="lede">
          Connect the accounts you want VAL Checker to monitor. Each account
          keeps its own store and watchlist matches.
        </p>
      </header>
      <ConnectedRiotAccounts
        accounts={accounts}
        disconnect={disconnectRiotSession}
      />
      <RiotConnectionPanel
        cloudConnectAvailable={false}
        createCaptureToken={createRiotCaptureToken}
        connectSession={connectRiotSession}
        initialLabel={reconnectAccount?.label ?? ""}
        initialRegion={reconnectAccount?.region ?? "ap"}
        initialState="disconnected"
        keepConnectFormOpen={!reconnectAccount}
        targetConnectionId={reconnectAccount?.id}
      />
    </main>
  );
}
