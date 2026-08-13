import "server-only";

interface ElevatedSupabaseEnvironment {
  readonly SUPABASE_SECRET_KEY?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
}

export function parseElevatedSupabaseKey(environment: ElevatedSupabaseEnvironment): string {
  const key =
    environment.SUPABASE_SECRET_KEY?.trim() ||
    environment.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!key) {
    throw new Error(
      "Missing environment variable: SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return key;
}

export function getElevatedSupabaseKey(): string {
  return parseElevatedSupabaseKey({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
