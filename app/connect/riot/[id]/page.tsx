import { redirect } from "next/navigation";

import { CloudRiotConnect } from "@/app/connect/riot/cloud-riot-connect";
import { canUseRiotCloudConnect } from "@/src/lib/riot/cloud-connect-policy";
import { resolveCloudConnectIdentity } from "@/src/lib/riot/cloud-connect-auth";

export default async function ExistingRiotConnectPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const identity = await resolveCloudConnectIdentity();
  if (!identity) redirect("/sign-in?next=/connect/riot");
  if (!canUseRiotCloudConnect(identity)) redirect("/dashboard/connection");
  return <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4"><h1>Connect Riot</h1><CloudRiotConnect initialSessionId={(await params).id} /></main>;
}
