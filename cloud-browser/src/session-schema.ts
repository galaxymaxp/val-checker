import { z } from "zod";

export const cloudBrowserSessionSchema = z.object({
  connectionSessionId: z.uuid(),
  // Postgres timestamptz values are returned with an explicit UTC offset
  // (for example, +00:00), while Date#toISOString uses Z. Both are valid ISO
  // datetimes and represent the same instant.
  expiresAt: z.iso.datetime({ offset: true }),
  viewport: z.object({
    height: z.number().int().min(568).max(1200),
    width: z.number().int().min(320).max(1440),
  }),
});

export type CloudBrowserSessionInput = z.infer<typeof cloudBrowserSessionSchema>;
