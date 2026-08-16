import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "@/app/dashboard/actions";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const email =
    typeof data?.claims.email === "string" ? data.claims.email : "your account";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-50 border-b border-line-soft bg-[#08090b]/70 backdrop-blur-xl">
        <div className="mx-auto flex min-h-14 w-full max-w-[var(--page)] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5 sm:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
            <Link
              className="shrink-0 text-sm font-medium tracking-tight text-ink! no-underline"
              href="/dashboard"
            >
              NIGHT.MARKET
              <span className="text-ink-dim">/WATCH</span>
            </Link>
            <nav
              aria-label="Dashboard sections"
              className="flex flex-wrap items-center gap-1"
            >
              <Link
                className="rounded-full px-3 py-1.5 text-sm text-ink-muted! no-underline hocus:bg-white/5 hocus:text-ink!"
                href="/dashboard"
              >
                Daily shop
              </Link>
              <Link
                className="rounded-full px-3 py-1.5 text-sm text-ink-muted! no-underline hocus:bg-white/5 hocus:text-ink!"
                href="/dashboard/connection"
              >
                Riot connection
              </Link>
            </nav>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden max-w-[16rem] truncate text-xs text-ink-dim sm:block">
              {email}
            </span>
            <form action={signOut}>
              <button className="sign-out-button" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="catalog-shell">{children}</div>
    </div>
  );
}
