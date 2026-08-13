interface PublicSupabaseEnvironment {
  readonly NEXT_PUBLIC_SUPABASE_URL?: string;
  readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

export interface PublicSupabaseConfig {
  readonly url: string;
  readonly key: string;
}

export function parsePublicSupabaseConfig(
  environment: PublicSupabaseEnvironment,
): PublicSupabaseConfig {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url) {
    throw new Error("Missing environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!key) {
    throw new Error(
      "Missing environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!new Set(["http:", "https:"]).has(parsedUrl.protocol)) {
    throw new Error("Invalid environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }

  return { url: parsedUrl.toString().replace(/\/$/, ""), key };
}

export function getPublicSupabaseConfig(): PublicSupabaseConfig {
  return parsePublicSupabaseConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
