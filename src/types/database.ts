type WeaponRow = {
  weapon_uuid: string;
  display_name: string;
  category: string | null;
};

type SkinRow = {
  skin_uuid: string;
  display_name: string;
  weapon_uuid: string | null;
  content_tier: string | null;
  display_icon: string | null;
  first_seen_at: string;
};

type SkinLevelRow = {
  level_uuid: string;
  skin_uuid: string;
  ordinal: number | null;
  first_seen_at: string;
};

type WatchlistRow = {
  id: string;
  user_id: string;
  skin_uuid: string;
  created_at: string;
};

type AuthStatus =
  | "CONNECTED"
  | "REAUTH_REQUIRED"
  | "RIOT_UNAVAILABLE"
  | "RATE_LIMITED"
  | "NETWORK_BLOCKED";

type RiotConnectionRow = {
  id: string;
  user_id: string;
  puuid: string | null;
  region: string | null;
  shard: string | null;
  encrypted_jar: string;
  jar_nonce: string;
  session_key_version: number;
  auth_status: AuthStatus;
  consecutive_failures: number;
  last_refresh_at: string | null;
  created_at: string;
};

type ShopCheckRow = {
  id: string;
  connection_id: string;
  checked_at: string;
  shop_hash: string;
  offer_skin_uuids: string[];
  total_cost: number | null;
  expires_at: string | null;
  night_market: unknown | null;
  bundle: unknown | null;
  rotation_date: string;
};

type NotificationRow = {
  id: string;
  user_id: string;
  skin_uuid: string;
  shop_check_id: string;
  created_at: string;
  emailed_at: string | null;
};

export interface Database {
  public: {
    Tables: {
      weapons: {
        Row: WeaponRow;
        Insert: WeaponRow;
        Update: Partial<WeaponRow>;
        Relationships: [];
      };
      skins: {
        Row: SkinRow;
        Insert: Omit<SkinRow, "first_seen_at"> & { first_seen_at?: string };
        Update: Partial<SkinRow>;
        Relationships: [];
      };
      skin_levels: {
        Row: SkinLevelRow;
        Insert: Omit<SkinLevelRow, "first_seen_at"> & { first_seen_at?: string };
        Update: Partial<SkinLevelRow>;
        Relationships: [];
      };
      watchlist: {
        Row: WatchlistRow;
        Insert: Omit<WatchlistRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<WatchlistRow>;
        Relationships: [];
      };
      riot_connections: {
        Row: RiotConnectionRow;
        Insert: Pick<
          RiotConnectionRow,
          "user_id" | "encrypted_jar" | "jar_nonce"
        > & {
          id?: string;
          created_at?: string;
          puuid?: string | null;
          region?: string | null;
          shard?: string | null;
          auth_status?: AuthStatus;
          consecutive_failures?: number;
          last_refresh_at?: string | null;
          session_key_version?: number;
        };
        Update: Partial<RiotConnectionRow>;
        Relationships: [];
      };
      shop_checks: {
        Row: ShopCheckRow;
        Insert: Pick<
          ShopCheckRow,
          "connection_id" | "rotation_date" | "shop_hash"
        > &
          Partial<
            Omit<
              ShopCheckRow,
              "connection_id" | "rotation_date" | "shop_hash"
            >
          >;
        Update: Partial<ShopCheckRow>;
        Relationships: [];
      };
      notifications: {
        Row: NotificationRow;
        Insert: Pick<
          NotificationRow,
          "shop_check_id" | "skin_uuid" | "user_id"
        > &
          Partial<
            Omit<
              NotificationRow,
              "shop_check_id" | "skin_uuid" | "user_id"
            >
          >;
        Update: Partial<NotificationRow>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      health_check: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      reserve_storefront_notification: {
        Args: {
          p_checked_at: string;
          p_connection_id: string;
          p_expires_at: string | null;
          p_offer_skin_uuids: string[];
          p_rotation_date: string;
          p_shop_hash: string;
          p_skin_uuid: string;
          p_user_id: string;
        };
        Returns: {
          notification_emailed_at: string | null;
          notification_id: string;
          shop_check_id: string;
        }[];
      };
    };
    Enums: {
      auth_status: AuthStatus;
    };
  };
}
