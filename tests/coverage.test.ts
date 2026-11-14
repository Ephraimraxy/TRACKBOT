import { describe, expect, it } from "vitest";

import { detailScore, maxUsableZoom, tileFor, verdictOf } from "@/lib/maps/coverage";

const picture = (fn: (x: number, y: number) => number) => {
  const px = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = fn(x, y);
    px.set([v, v, v, 255], (y * 64 + x) * 4);
  }
  return px;
};

describe("map coverage measurements", () => {
  it("scores a blank tile near zero and a detailed one high", () => {
    const blank = detailScore(picture(() => 200));
    const detailed = detailScore(picture((x, y) => ((x * 7 + y * 13) % 5) * 50));
    expect(blank).toBe(0);
    expect(detailed).toBeGreaterThan(20);
    expect(verdictOf(blank)).toBe("missing");
    expect(verdictOf(detailed)).toBe("sharp");
    expect(verdictOf(3)).toBe("soft");
  });

  it("finds the closest zoom that still has detail", () => {
    expect(maxUsableZoom([{ zoom: 16, score: 12 }, { zoom: 17, score: 9 }, { zoom: 18, score: 4 }, { zoom: 19, score: 0.4 }, { zoom: 20, score: null }])).toBe(18);
    expect(maxUsableZoom([{ zoom: 17, score: null }])).toBe(0);
  });

  it("works out which tile holds a point (Keffi at zoom 17)", () => {
    expect(tileFor(8.8465, 7.8737, 17)).toEqual({ x: 68402, y: 62302 });
    const t = tileFor(0, 0, 1);
    expect(t).toEqual({ x: 1, y: 1 });
    expect(tileFor(85, -179.9, 2).x).toBe(0);
  });
});
