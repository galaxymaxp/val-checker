import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Database,
  RiotCloudConnectionState,
} from "@/src/types/database";

export const RIOT_CLOUD_CONNECTION_TTL_MS = 8 * 60 * 1_000;

export type CloudSessionRow =
  Database["public"]["Tables"]["riot_cloud_connection_sessions"]["Row"];

export class CloudConnectionStorageError extends Error {
  constructor() {
    super("Temporary Riot connection session storage failed.");
    this.name = "CloudConnectionStorageError";
  }
}

export interface CloudConnectionStore {
  create(input: {
    readonly connectionId?: string | null;
    readonly label?: string | null;
    readonly region: string;
    readonly userId: string;
  }): Promise<CloudSessionRow>;
  loadOwned(id: string, userId: string): Promise<CloudSessionRow | null>;
  attachProvider(
    id: string,
    userId: string,
    providerSessionId: string,
  ): Promise<CloudSessionRow>;
  updateOwned(
    id: string,
    userId: string,
    values: Database["public"]["Tables"]["riot_cloud_connection_sessions"]["Update"],
    fromStates?: readonly RiotCloudConnectionState[],
  ): Promise<CloudSessionRow>;
  claimCapture(id: string, userId: string): Promise<CloudSessionRow | null>;
}

export class SupabaseCloudConnectionStore implements CloudConnectionStore {
  constructor(
    private readonly admin: SupabaseClient<Database>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: {
    readonly connectionId?: string | null;
    readonly label?: string | null;
    readonly region: string;
    readonly userId: string;
  }): Promise<CloudSessionRow> {
    const expiresAt = new Date(this.now().getTime() + RIOT_CLOUD_CONNECTION_TTL_MS);
    const { data, error } = await this.admin
      .from("riot_cloud_connection_sessions")
      .insert({
        expires_at: expiresAt.toISOString(),
        label: input.label ?? null,
        region: input.region,
        target_connection_id: input.connectionId ?? null,
        user_id: input.userId,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new CloudConnectionStorageError();
    }
    return data;
  }

  async loadOwned(id: string, userId: string): Promise<CloudSessionRow | null> {
    const { data, error } = await this.admin
      .from("riot_cloud_connection_sessions")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      throw new CloudConnectionStorageError();
    }
    return data;
  }

  async attachProvider(
    id: string,
    userId: string,
    providerSessionId: string,
  ): Promise<CloudSessionRow> {
    return this.updateOwned(id, userId, {
      provider_session_id: providerSessionId,
      state: "waiting_for_user",
    }, ["created", "starting_browser"]);
  }

  async updateOwned(
    id: string,
    userId: string,
    values: Database["public"]["Tables"]["riot_cloud_connection_sessions"]["Update"],
    fromStates?: readonly RiotCloudConnectionState[],
  ): Promise<CloudSessionRow> {
    let query = this.admin
      .from("riot_cloud_connection_sessions")
      .update(values)
      .eq("id", id)
      .eq("user_id", userId);
    if (fromStates?.length) {
      query = query.in("state", [...fromStates]);
    }
    const { data, error } = await query.select("*").maybeSingle();
    if (error || !data) {
      throw new CloudConnectionStorageError();
    }
    return data;
  }

  async claimCapture(id: string, userId: string): Promise<CloudSessionRow | null> {
    const now = this.now().toISOString();
    const { data, error } = await this.admin
      .from("riot_cloud_connection_sessions")
      .update({ state: "capturing_session" })
      .eq("id", id)
      .eq("user_id", userId)
      .in("state", ["waiting_for_user", "authenticating"])
      .gt("expires_at", now)
      .is("consumed_at", null)
      .select("*")
      .maybeSingle();
    if (error) {
      throw new CloudConnectionStorageError();
    }
    return data;
  }
}
