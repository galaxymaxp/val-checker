type WeaponRow = {
  weapon_uuid: string;
  display_name: string;
  category: string | null;
  display_icon: string | null;
  default_skin_uuid: string | null;
  shop_category: string | null;
  inventory_label: string | null;
  inventory_ordinal: number | null;
};

type SkinRow = {
  skin_uuid: string;
  display_name: string;
  weapon_uuid: string | null;
  content_tier_uuid: string | null;
  display_icon: string | null;
  full_render: string | null;
  theme_uuid: string | null;
  wallpaper: string | null;
  first_seen_at: string;
};

type SkinLevelRow = {
  level_uuid: string;
  skin_uuid: string;
  ordinal: number | null;
  display_name: string | null;
  level_item: string | null;
  display_icon: string | null;
  streamed_video: string | null;
  first_seen_at: string;
};

type SkinChromaRow = {
  chroma_uuid: string;
  skin_uuid: string;
  ordinal: number;
  display_name: string;
  variant_label: string | null;
  display_icon: string | null;
  full_render: string | null;
  swatch: string | null;
  streamed_video: string | null;
  first_seen_at: string;
};

type ContentTierRow = {
  content_tier_uuid: string;
  display_name: string;
  dev_name: string;
  rank: number;
  highlight_color: string | null;
  display_icon: string | null;
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

type ManualRefreshFailureReason =
  | "LIFECYCLE_STALE"
  | "REAUTH_FAILED"
  | "SESSION_UNAVAILABLE"
  | "STOREFRONT_FAILED"
  | "UNEXPECTED";

type ManualRefreshStatus =
  | "claimed"
  | "requesting"
  | "retryable_failed"
  | "succeeded";

type RefreshTrigger = "cron" | "manual" | "operator";

type RiotRunReason =
  | "ACCOUNT_UNAVAILABLE"
  | "ATTEMPT_FENCED"
  | "CATALOG_FAILED"
  | "DAILY_CLAIM_HELD"
  | "DELIVERY_FAILED"
  | "LIFECYCLE_STALE"
  | "MANUAL_CLAIM_HELD"
  | "NOT_ALLOWLISTED"
  | "REAUTH_FAILED"
  | "REAUTH_REQUIRED_SKIP"
  | "SESSION_UNAVAILABLE"
  | "SESSION_LEASE_HELD"
  | "STOREFRONT_FAILED"
  | "UNEXPECTED";

type StorefrontOfferDetail = {
  readonly costs: readonly {
    readonly amount: number;
    readonly currencyUuid: string;
  }[];
  readonly offerId: string;
  readonly rewards: readonly {
    readonly levelUuid: string;
    readonly quantity: number;
    readonly skinUuid?: string | null;
  }[];
};

type RiotConnectionRow = {
  id: string;
  user_id: string;
  connection_epoch: string;
  label: string | null;
  puuid: string | null;
  region: string | null;
  shard: string | null;
  encrypted_jar: string;
  jar_nonce: string;
  session_key_version: number;
  auth_status: AuthStatus;
  consecutive_failures: number;
  last_refresh_at: string | null;
  rotation_lease_claimed_at: string | null;
  rotation_lease_store_date: string | null;
  rotation_lease_storefront_attempted_at: string | null;
  rotation_lease_token: string | null;
  created_at: string;
};

type RiotDailyRunRow = {
  id: string;
  user_id: string;
  connection_id: string;
  connection_epoch: string;
  store_date: string;
  claimed_at: string;
  storefront_attempted_at: string | null;
  storefront_failed_at: string | null;
  storefront_failure_reason: "STOREFRONT_FAILED" | null;
};

type RiotManualRefreshRow = {
  id: string;
  riot_puuid: string;
  user_id: string;
  connection_id: string;
  connection_epoch: string;
  store_date: string;
  claim_token: string;
  status: ManualRefreshStatus;
  claimed_at: string;
  storefront_attempted_at: string | null;
  succeeded_at: string | null;
  failed_at: string | null;
  failure_reason: ManualRefreshFailureReason | null;
};

type RiotRunLogRow = {
  id: string;
  user_id: string;
  connection_id: string;
  run_id: string | null;
  store_date: string | null;
  ran_at: string;
  outcome: "checked" | "failed" | "skipped";
  reason: RiotRunReason | null;
  classification: "OK" | "DEAD" | "UNKNOWN" | "ERROR" | null;
  matches_found: number;
  emails_sent: number;
  trigger: RefreshTrigger;
};

/** Short-lived MFA hand-off material. Never holds a credential. */
type RiotPendingAuthRow = {
  id: string;
  user_id: string;
  encrypted_jar: string;
  jar_nonce: string;
  session_key_version: number;
  connection_id: string | null;
  region: string | null;
  label: string | null;
  created_at: string;
  expires_at: string;
};

type ShopCheckRow = {
  id: string;
  connection_id: string;
  checked_at: string;
  shop_hash: string;
  offer_skin_uuids: string[];
  offer_details: readonly StorefrontOfferDetail[];
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
  delivery_attempted_at: string | null;
  emailed_at: string | null;
};

export interface Database {
  public: {
    Tables: {
      weapons: {
        Row: WeaponRow;
        Insert: Omit<
          WeaponRow,
          | "default_skin_uuid"
          | "display_icon"
          | "inventory_label"
          | "inventory_ordinal"
          | "shop_category"
        > & {
          default_skin_uuid?: string | null;
          display_icon?: string | null;
          inventory_label?: string | null;
          inventory_ordinal?: number | null;
          shop_category?: string | null;
        };
        Update: Partial<WeaponRow>;
        Relationships: [];
      };
      skins: {
        Row: SkinRow;
        Insert: Omit<
          SkinRow,
          | "content_tier_uuid"
          | "first_seen_at"
          | "full_render"
          | "theme_uuid"
          | "wallpaper"
        > & {
          content_tier_uuid?: string | null;
          first_seen_at?: string;
          full_render?: string | null;
          theme_uuid?: string | null;
          wallpaper?: string | null;
        };
        Update: Partial<SkinRow>;
        Relationships: [];
      };
      skin_levels: {
        Row: SkinLevelRow;
        Insert: Omit<
          SkinLevelRow,
          | "display_icon"
          | "display_name"
          | "first_seen_at"
          | "level_item"
          | "streamed_video"
        > & {
          display_icon?: string | null;
          display_name?: string | null;
          first_seen_at?: string;
          level_item?: string | null;
          streamed_video?: string | null;
        };
        Update: Partial<SkinLevelRow>;
        Relationships: [];
      };
      skin_chromas: {
        Row: SkinChromaRow;
        Insert: Omit<SkinChromaRow, "first_seen_at"> & { first_seen_at?: string };
        Update: Partial<SkinChromaRow>;
        Relationships: [];
      };
      content_tiers: {
        Row: ContentTierRow;
        Insert: Omit<ContentTierRow, "first_seen_at"> & { first_seen_at?: string };
        Update: Partial<ContentTierRow>;
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
          label?: string | null;
          auth_status?: AuthStatus;
          connection_epoch?: string;
          consecutive_failures?: number;
          last_refresh_at?: string | null;
          rotation_lease_claimed_at?: string | null;
          rotation_lease_store_date?: string | null;
          rotation_lease_storefront_attempted_at?: string | null;
          rotation_lease_token?: string | null;
          session_key_version?: number;
        };
        Update: Partial<RiotConnectionRow>;
        Relationships: [];
      };
      riot_daily_runs: {
        Row: RiotDailyRunRow;
        Insert: Pick<
          RiotDailyRunRow,
          "user_id" | "connection_id" | "connection_epoch" | "store_date"
        > &
          Partial<
            Omit<
              RiotDailyRunRow,
              "user_id" | "connection_id" | "connection_epoch" | "store_date"
            >
          >;
        Update: Partial<RiotDailyRunRow>;
        Relationships: [];
      };
      riot_manual_refreshes: {
        Row: RiotManualRefreshRow;
        Insert: Pick<
          RiotManualRefreshRow,
          | "riot_puuid"
          | "user_id"
          | "connection_id"
          | "connection_epoch"
          | "store_date"
        > &
          Partial<
            Omit<
              RiotManualRefreshRow,
              | "riot_puuid"
              | "user_id"
              | "connection_id"
              | "connection_epoch"
              | "store_date"
            >
          >;
        Update: Partial<RiotManualRefreshRow>;
        Relationships: [];
      };
      riot_pending_auth: {
        Row: RiotPendingAuthRow;
        Insert: Pick<
          RiotPendingAuthRow,
          "user_id" | "encrypted_jar" | "jar_nonce" | "expires_at"
        > &
          Partial<
            Omit<
              RiotPendingAuthRow,
              "user_id" | "encrypted_jar" | "jar_nonce" | "expires_at"
            >
          >;
        Update: Partial<RiotPendingAuthRow>;
        Relationships: [];
      };
      riot_run_logs: {
        Row: RiotRunLogRow;
        Insert: Pick<RiotRunLogRow, "user_id" | "connection_id" | "outcome"> &
          Partial<
            Omit<RiotRunLogRow, "user_id" | "connection_id" | "outcome">
          >;
        Update: Partial<RiotRunLogRow>;
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
      purge_expired_riot_pending_auth: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      claim_riot_daily_run: {
        Args: {
          p_connection_epoch: string;
          p_connection_id: string;
          p_rotation_lease_token: string;
          p_user_id: string;
        };
        Returns: {
          claimed_at: string;
          run_id: string;
          store_date: string;
        }[];
      };
      get_riot_store_day: {
        Args: Record<PropertyKey, never>;
        Returns: {
          next_reset_at: string;
          store_date: string;
        }[];
      };
      claim_riot_manual_refresh: {
        Args: {
          p_connection_epoch: string;
          p_connection_id: string;
          p_rotation_lease_token: string;
          p_user_id: string;
        };
        Returns: {
          claimed_at: string | null;
          claim_status: "account_unavailable" | "claimed" | "held";
          claim_token: string | null;
          next_reset_at: string;
          run_id: string | null;
          store_date: string;
        }[];
      };
      claim_riot_session_rotation: {
        Args: {
          p_connection_epoch: string;
          p_connection_id: string;
          p_user_id: string;
        };
        Returns: {
          claimed_at: string | null;
          lease_status: "account_unavailable" | "acquired" | "held";
          lease_token: string | null;
          store_date: string;
        }[];
      };
      mark_riot_storefront_attempt: {
        Args: {
          p_connection_epoch: string;
          p_connection_id: string;
          p_rotation_lease_token: string;
          p_run_id: string;
          p_user_id: string;
        };
        Returns: { attempted_at: string }[];
      };
      renew_riot_session_rotation: {
        Args: {
          p_connection_epoch: string;
          p_connection_id: string;
          p_lease_token: string;
          p_user_id: string;
        };
        Returns: { renewed_at: string }[];
      };
      mark_riot_manual_storefront_attempt: {
        Args: {
          p_claim_token: string;
          p_connection_epoch: string;
          p_connection_id: string;
          p_rotation_lease_token: string;
          p_run_id: string;
          p_user_id: string;
        };
        Returns: { attempted_at: string }[];
      };
      release_riot_session_rotation: {
        Args: {
          p_connection_epoch: string;
          p_connection_id: string;
          p_lease_token: string;
          p_user_id: string;
        };
        Returns: { released_at: string }[];
      };
      fail_riot_manual_refresh: {
        Args: {
          p_claim_token: string;
          p_connection_epoch: string;
          p_connection_id: string;
          p_failure_reason: ManualRefreshFailureReason;
          p_retryable: boolean;
          p_run_id: string;
          p_user_id: string;
        };
        Returns: {
          failed_at: string;
          status: ManualRefreshStatus;
        }[];
      };
      close_riot_storefront_attempt: {
        Args: {
          p_claim_token: string | null;
          p_connection_epoch: string;
          p_connection_id: string;
          p_rotation_lease_token: string;
          p_run_id: string;
          p_trigger: RefreshTrigger;
          p_user_id: string;
        };
        Returns: { closed_at: string }[];
      };
      record_storefront_refresh: {
        Args: {
          p_checked_at: string;
          p_connection_epoch: string;
          p_connection_id: string;
          p_expires_at: string | null;
          p_manual_claim_token?: string | null;
          p_manual_run_id?: string | null;
          p_offer_details: readonly StorefrontOfferDetail[];
          p_offer_skin_uuids: string[];
          p_rotation_date: string;
          p_rotation_lease_token?: string | null;
          p_shop_hash: string;
          p_user_id: string;
        };
        Returns: {
          manual_succeeded_at: string | null;
          shop_check_id: string;
        }[];
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
          notification_delivery_claimed: boolean;
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
