import type { NextRequest } from "next/server";

import { refreshAuthSession } from "@/src/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return refreshAuthSession(request);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
