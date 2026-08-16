import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { HERO_FRAMES } from "@/src/lib/webgl/hero-frames";

describe("hero frames", () => {
  it("pins at least two frames so the morph always has a pair", () => {
    expect(HERO_FRAMES.length).toBeGreaterThanOrEqual(2);
  });

  it("points every frame at a baked asset with sane metadata", () => {
    for (const frame of HERO_FRAMES) {
      const asset = path.join(process.cwd(), "public", frame.src);

      expect(fs.existsSync(asset), `missing asset for ${frame.id}`).toBe(true);
      expect(frame.height).toBeGreaterThan(0);
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.label.length).toBeGreaterThan(0);
      expect(frame.tierColor).toHaveLength(3);

      for (const component of frame.tierColor) {
        expect(component).toBeGreaterThanOrEqual(0);
        expect(component).toBeLessThanOrEqual(1);
      }
    }
  });
});
