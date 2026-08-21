import { NextResponse, type NextRequest } from "next/server";

import { isDevPreview } from "@/src/lib/dev/preview";
import { refreshAuthSession } from "@/src/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // Local preview has no Supabase session to refresh, and calling for one
  // without credentials fails the request before any page renders.
  if (isDevPreview()) {
    return NextResponse.next();
  }

  return refreshAuthSession(request);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
