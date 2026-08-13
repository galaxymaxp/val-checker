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
    };
    Views: Record<never, never>;
    Functions: {
      health_check: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
    };
  };
}
