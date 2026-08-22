import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260822115437_scope_watchlist_by_riot_connection.sql",
  ),
  "utf8",
);

describe("account-scoped watchlist migration", () => {
  it("moves each legacy wishlist to one deterministic Riot connection", () => {
    expect(migration).toMatch(
      /select distinct on \(user_id\) id, user_id[\s\S]*order by user_id, created_at, id/i,
    );
    expect(migration).not.toMatch(/insert into public\.watchlist[\s\S]*select/i);
  });

  it("allows the same skin on sibling accounts while enforcing connection ownership", () => {
    expect(migration).toMatch(
      /foreign key \(connection_id, user_id\)[\s\S]*references public\.riot_connections \(id, user_id\)/i,
    );
    expect(migration).toMatch(
      /unique \(connection_id, skin_uuid\)/i,
    );
    expect(migration).toMatch(/drop constraint watchlist_user_id_skin_uuid_key/i);
    expect(migration).toMatch(/with check \([\s\S]*connection_id is not null/i);
  });
});
