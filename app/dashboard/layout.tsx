import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

import { signOut } from "@/app/dashboard/actions";
import { DEV_PREVIEW_EMAIL, isDevPreview } from "@/src/lib/dev/preview";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const email = isDevPreview()
    ? DEV_PREVIEW_EMAIL
    : await (async () => {
        const supabase = await createServerSupabaseClient();
        const { data } = await supabase.auth.getClaims();
        return typeof data?.claims.email === "string"
          ? data.claims.email
          : "your account";
      })();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="dashboard-header">
        <div className="dashboard-header-inner">
          <Link className="dashboard-brand" href="/dashboard">
            <Image
              alt=""
              aria-hidden="true"
              className="dashboard-brand-mark"
              height={40}
              src="/brand/val-checker-eye-vandal.png"
              width={40}
            />
            VAL <span>CHECKER</span>
          </Link>

          <nav aria-label="Dashboard sections" className="dashboard-desktop-nav">
            <Link href="/dashboard">Store</Link>
            <Link href="/dashboard#watchlist">Watchlist</Link>
            <Link href="/dashboard/connection">Riot accounts</Link>
          </nav>

          <div className="dashboard-desktop-account">
            <span title={email}>{email}</span>
            <form action={signOut}>
              <button className="sign-out-button" type="submit">
                Sign out
              </button>
            </form>
          </div>

          <details className="dashboard-mobile-menu">
            <summary>Menu</summary>
            <div className="dashboard-mobile-menu-panel">
              <nav aria-label="Mobile dashboard sections">
                <Link href="/dashboard">Store</Link>
                <Link href="/dashboard#watchlist">Watchlist</Link>
                <Link href="/dashboard/connection">Riot accounts</Link>
              </nav>
              <div className="dashboard-mobile-account">
                <span title={email}>{email}</span>
                <form action={signOut}>
                  <button className="sign-out-button" type="submit">
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </details>
        </div>
      </header>
      <div className="catalog-shell">{children}</div>
    </div>
  );
}
