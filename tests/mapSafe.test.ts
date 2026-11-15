import { describe, expect, it, vi } from "vitest";

import { safeGetSource, safeSetData, safely } from "@/lib/maps/safe";

const FC = { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;

describe("safe map helpers (the style-load race)", () => {
  it("do not throw when the map has no style yet, which is what crashed the tracking pages", () => {
    // MapLibre throws "Cannot read properties of null (reading 'getSource')" until the style exists
    const early = { getSource: () => { throw new TypeError("Cannot read properties of null (reading 'getSource')"); } } as never;
    expect(() => safeGetSource(early, "planned")).not.toThrow();
    expect(safeGetSource(early, "planned")).toBeUndefined();
    expect(safeSetData(early, "planned", FC)).toBe(false);
  });

  it("do nothing for a missing map or source, and set data when it is ready", () => {
    expect(safeSetData(null, "x", FC)).toBe(false);
    expect(safeSetData({ getSource: () => undefined } as never, "x", FC)).toBe(false);
    const setData = vi.fn();
    expect(safeSetData({ getSource: () => ({ setData }) } as never, "x", FC)).toBe(true);
    expect(setData).toHaveBeenCalledWith(FC);
  });

  it("report false when setData itself throws (map removed mid-call)", () => {
    expect(safeSetData({ getSource: () => ({ setData: () => { throw new Error("removed"); } }) } as never, "x", FC)).toBe(false);
  });

  it("safely returns the fallback on error", () => {
    expect(safely(() => { throw new Error("x"); }, 7)).toBe(7);
    expect(safely(() => 3, 7)).toBe(3);
  });
});
