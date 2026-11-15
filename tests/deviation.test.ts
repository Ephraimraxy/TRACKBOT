import { describe, expect, it } from "vitest";

import { DEVIATION_MIN_FIXES, isSustainedDeviation, MAX_USABLE_ACCURACY, offRouteThreshold, type Fix } from "@/lib/services/deviation";

const line: [number, number][] = [[7.87, 8.84], [7.88, 8.84]]; // east-west
// latitude offsets: 0.001 degrees is about 111 m
const fix = (secondsAgo: number, latOffset: number, accuracy: number | null = 10): Fix => ({ latitude: 8.84 + latOffset, longitude: 7.875, accuracy, at: 1_000_000 - secondsAgo * 1000 });

describe("sustained deviation from the planned road", () => {
  it("is false for fixes on the road", () => {
    expect(isSustainedDeviation([fix(0, 0), fix(10, 0), fix(20, 0)], line)).toBe(false);
  });

  it("is true for several accurate fixes in a row, well away, over enough time", () => {
    expect(isSustainedDeviation([fix(0, 0.002), fix(10, 0.002), fix(20, 0.002)], line)).toBe(true);
  });

  it("is false for a single stray fix", () => {
    expect(isSustainedDeviation([fix(0, 0.002), fix(10, 0), fix(20, 0)], line)).toBe(false);
  });

  it("is false when the fixes are away but too close together in time", () => {
    expect(isSustainedDeviation([fix(0, 0.002), fix(2, 0.002), fix(4, 0.002)], line)).toBe(false);
    expect(DEVIATION_MIN_FIXES).toBe(3);
  });

  it("is false if the driver is back near the road in the newest fix", () => {
    expect(isSustainedDeviation([fix(0, 0), fix(10, 0.002), fix(20, 0.002), fix(30, 0.002)], line)).toBe(false);
  });

  it("widens the threshold by the fix's own accuracy: 90 m away with ±80 m is not 'off'", () => {
    expect(offRouteThreshold(80)).toBe(140);
    expect(isSustainedDeviation([fix(0, 0.0008, 80), fix(10, 0.0008, 80), fix(20, 0.0008, 80)], line)).toBe(false); // ~89 m < 140 m
    expect(isSustainedDeviation([fix(0, 0.0008, 5), fix(10, 0.0008, 5), fix(20, 0.0008, 5)], line)).toBe(true); // ~89 m > 65 m
  });

  it("ignores fixes too inaccurate to judge, in either direction", () => {
    const wild = MAX_USABLE_ACCURACY + 1;
    expect(isSustainedDeviation([fix(0, 0.01, wild), fix(10, 0.01, wild), fix(20, 0.01, wild)], line)).toBe(false);
    // wild fixes do not break a real deviation either
    expect(isSustainedDeviation([fix(0, 0.002), fix(5, 0, wild), fix(10, 0.002), fix(20, 0.002)], line)).toBe(true);
  });

  it("copes with unordered input and no line", () => {
    expect(isSustainedDeviation([fix(20, 0.002), fix(0, 0.002), fix(10, 0.002)], line)).toBe(true);
    expect(isSustainedDeviation([fix(0, 0.002)], [])).toBe(false);
  });
});
