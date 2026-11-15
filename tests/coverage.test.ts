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

import { summariseCoverage } from "@/lib/maps/coverage";

describe("summarising imagery coverage", () => {
  const s = (zoom: number, score: number | null, hash?: string) => ({ zoom, score, hash });
  it("rates each zoom level from its sampled tiles", () => {
    const rows = summariseCoverage([
      s(17, 12, "a"), s(17, 14, "b"), s(17, 9, "c"), s(17, 11, "d"),
      s(19, 3, "e"), s(19, 3.5, "f"), s(19, 4, "g"), s(19, 3.1, "h"),
      s(20, 0.2, "i"), s(20, 0.3, "j"), s(20, null),
    ]);
    expect(rows.map((r) => [r.zoom, r.verdict])).toEqual([[17, "sharp"], [19, "soft"], [20, "missing"]]);
    expect(rows[2]).toMatchObject({ sampled: 3, unreachable: 1 });
  });
  it("catches a 'no imagery here' placeholder repeated across tiles, even though it scores like a picture", () => {
    const rows = summariseCoverage(Array.from({ length: 6 }, () => s(18, 8, "same")));
    expect(rows[0]).toMatchObject({ placeholderSuspected: true, verdict: "missing" });
  });
  it("says unreachable when nothing could be fetched", () => {
    expect(summariseCoverage([s(16, null), s(16, null)])[0].verdict).toBe("unreachable");
  });
});
