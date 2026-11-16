import { describe, expect, it } from "vitest";

import { analyseTrack, findingsFor, type TrackPoint } from "@/lib/analytics/trackAnalysis";

const T0 = 1_700_000_000_000;
// 0.0001 degrees of longitude at this latitude is about 11 m
const pt = (sec: number, lngSteps: number, extra: Partial<TrackPoint> = {}): TrackPoint => ({ latitude: 8.84, longitude: 7.87 + lngSteps * 0.0001, accuracy: 8, at: T0 + sec * 1000, backfilled: false, ...extra });
/** Driving east at about 11 m per 2 s (about 20 km/h) for n points. */
const drive = (n: number, start = 0, from = 0) => Array.from({ length: n }, (_, i) => pt(start + i * 2, from + i));

describe("analysing a delivery's GPS track", () => {
  it("measures distance, time and speed of a steady drive", () => {
    const a = analyseTrack(drive(60));
    expect(a.points).toBe(60);
    expect(a.durationSeconds).toBe(118);
    expect(a.distanceMetres).toBeGreaterThan(600);
    expect(a.distanceMetres).toBeLessThan(700);
    expect(a.averageSpeedKmh).toBeGreaterThan(15);
    expect(a.averageSpeedKmh).toBeLessThan(25);
    expect(a.gaps).toEqual([]);
    expect(a.jumps).toEqual([]);
    expect(findingsFor(a)).toEqual([]);
  });

  it("finds signal gaps and reports them in plain words", () => {
    const a = analyseTrack([...drive(10), ...drive(10, 200, 10)]); // 180 s of silence in the middle
    expect(a.gaps).toHaveLength(1);
    expect(a.gaps[0].seconds).toBeGreaterThan(150);
    expect(a.gps.longestGapSeconds).toBeGreaterThan(150);
    expect(findingsFor(a).some((f) => f.kind === "gps_gap")).toBe(true);
  });

  it("finds stops, and does not count the waiting as driving", () => {
    const wait = Array.from({ length: 20 }, (_, i) => pt(40 + i * 10, 20, { latitude: 8.84 + (i % 2) * 0.00001 })); // 190 s in one place
    const a = analyseTrack([...drive(20), ...wait, ...drive(10, 240, 21)]);
    expect(a.stops).toHaveLength(1);
    expect(a.stops[0].seconds).toBeGreaterThanOrEqual(120);
    expect(a.movingSpeedKmh!).toBeGreaterThan(a.averageSpeedKmh!);
  });

  it("ignores an impossible GPS jump instead of adding it to the distance", () => {
    const withJump = analyseTrack([...drive(5), pt(10, 5000), ...drive(5, 12, 5)]); // ~55 km sideways in 2 s, then back
    expect(withJump.jumps.length).toBeGreaterThanOrEqual(1);
    expect(withJump.distanceMetres).toBeLessThan(500);
    expect(findingsFor(withJump).some((f) => f.kind === "gps_jump")).toBe(true);
  });

  it("flags vague GPS, and does not measure distance from vague fixes", () => {
    const vague = drive(20).map((p, i) => (i % 2 === 0 ? { ...p, accuracy: 400 } : p));
    const a = analyseTrack(vague);
    expect(a.gps.poorAccuracyShare).toBeCloseTo(0.5);
    expect(findingsFor(a).some((f) => f.kind === "gps_poor")).toBe(true);
  });

  it("counts late (offline-queue) points and keeps them in their real time order", () => {
    const pts = drive(10);
    pts[3] = { ...pts[3], backfilled: true };
    const a = analyseTrack([...pts].reverse());
    expect(a.gps.backfilledPoints).toBe(1);
    expect(a.firstAt).toBe(T0);
    expect(findingsFor(a).some((f) => f.kind === "late_points")).toBe(true);
  });

  it("finds when the driver left the planned road, and when they came back", () => {
    const route: [number, number][] = [[7.87, 8.84], [7.88, 8.84]];
    const onRoad = drive(10);
    const away = Array.from({ length: 12 }, (_, i) => pt(20 + i * 5, 10 + i, { latitude: 8.8425 })); // ~280 m north for 60 s
    const back = Array.from({ length: 6 }, (_, i) => pt(80 + i * 5, 22 + i));
    const a = analyseTrack([...onRoad, ...away, ...back], route);
    expect(a.deviations).toHaveLength(1);
    expect(a.deviations![0].maxMetresFromRoute).toBeGreaterThan(200);
    expect(a.deviations![0].seconds).toBeGreaterThan(30);
    expect(findingsFor(a).some((f) => f.kind === "deviation")).toBe(true);
  });

  it("does not call one stray fix a deviation, and says nothing about deviation without a planned road", () => {
    const route: [number, number][] = [[7.87, 8.84], [7.88, 8.84]];
    const pts = drive(30);
    pts[15] = { ...pts[15], latitude: 8.8425 };
    expect(analyseTrack(pts, route).deviations).toEqual([]);
    expect(analyseTrack(pts, null).deviations).toBeNull();
  });

  it("copes with no points and a single point", () => {
    expect(analyseTrack([]).points).toBe(0);
    const one = analyseTrack([pt(0, 0)]);
    expect(one.distanceMetres).toBe(0);
    expect(findingsFor(one)[0].kind).toBe("few_points");
  });
});
