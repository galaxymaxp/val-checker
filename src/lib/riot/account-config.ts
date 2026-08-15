import { z } from "zod";

const riotRegionSchema = z.enum(["na", "eu", "ap", "kr"]);

export type RiotRegion = z.infer<typeof riotRegionSchema>;

export class RiotAccountConfigInputError extends Error {
  constructor() {
    super("The Riot account configuration is invalid.");
    this.name = "RiotAccountConfigInputError";
  }
}

export function parseRiotRegion(value: unknown): RiotRegion {
  const parsed = riotRegionSchema.safeParse(value ?? "ap");
  if (!parsed.success) {
    throw new RiotAccountConfigInputError();
  }

  return parsed.data;
}
