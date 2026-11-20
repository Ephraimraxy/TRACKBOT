import { describe, expect, it } from "vitest";

import { centroidOf, filterFootprints, footprintAreaM2, parseFootprints, ringAreaM2, type Footprint } from "@/lib/maps/footprints";
import { addFootprintsLayer, FOOTPRINT_LAYER } from "@/lib/maps/styles";

const KEFFI: [number, number, number, number] = [7.82, 8.80, 7.93, 8.92];
// 0.0002 degrees is about 22 m: a house of about 490 m²
const square = (lng: number, lat: number, size = 0.0002, props: Record<string, unknown> = {}): Footprint => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [[[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]]] } });

describe("building footprints", () => {
  it("measures areas in square metres", () => {
    const a = ringAreaM2(square(7.87, 8.84).geometry.coordinates[0] as [number, number][]);
    expect(a).toBeGreaterThan(450);
    expect(a).toBeLessThan(530);
    // a courtyard hole is subtracted
    const withHole: Footprint = { ...square(7.87, 8.84), geometry: { type: "Polygon", coordinates: [square(7.87, 8.84, 0.0004).geometry.coordinates[0] as [number, number][], square(7.8701, 8.8401, 0.0001).geometry.coordinates[0] as [number, number][]] } };
    expect(footprintAreaM2(withHole)).toBeLessThan(ringAreaM2(withHole.geometry.coordinates[0] as [number, number][]));
    expect(centroidOf(square(7.87, 8.84))).toEqual([expect.closeTo(7.8700, 3), expect.closeTo(8.8400, 3)]);
  });

  it("keeps buildings inside the area and of a plausible size, and gives each a height", () => {
    const r = filterFootprints(
      [square(7.87, 8.84), square(7.871, 8.841, 0.0002, { height: 9 }), square(7.2, 8.0), square(7.872, 8.842, 0.00002), square(7.873, 8.843, 0.003), { type: "Feature", properties: {}, geometry: null as never }],
      { bbox: KEFFI },
    );
    expect(r).toMatchObject({ read: 6, kept: 2, outsideArea: 1, tooSmall: 1, tooLarge: 1, invalid: 1 });
    expect(r.features.map((f) => f.properties.height)).toEqual([5, 9]); // default height, and the data's own
  });

  it("ignores nonsense heights, trims coordinates, and stops at the limit", () => {
    const r = filterFootprints([square(7.87, 8.84, 0.0002, { height: -3 }), square(7.871, 8.84, 0.0002, { height: 5000 }), square(7.872, 8.84)], { bbox: KEFFI, maxFeatures: 2 });
    expect(r.kept).toBe(2);
    expect(r.cappedAt).toBe(2);
    expect(r.features.map((f) => f.properties.height)).toEqual([5, 5]);
    const coords = JSON.stringify(r.features[0].geometry.coordinates);
    expect(coords).not.toMatch(/\d\.\d{7}/);
  });

  it("reads a FeatureCollection, a single feature, or one feature per line, and skips damage", () => {
    const f = square(7.87, 8.84);
    expect(parseFootprints(JSON.stringify({ type: "FeatureCollection", features: [f, f] }))).toHaveLength(2);
    expect(parseFootprints(JSON.stringify(f))).toHaveLength(1);
    expect(parseFootprints([JSON.stringify(f), "garbage", JSON.stringify(f), ""].join("\n"))).toHaveLength(2);
    expect(parseFootprints("")).toEqual([]);
  });
});

describe("the optional 3D houses layer on the map", () => {
  const fakeMap = () => {
    const calls: string[] = [];
    let has = false;
    return { calls, getSource: () => (has ? {} : undefined), addSource: (id: string) => { has = true; calls.push(`source:${id}`); }, addLayer: (l: { id: string }) => calls.push(`layer:${l.id}`) };
  };

  it("does nothing without a footprint file configured", () => {
    const m = fakeMap();
    expect(addFootprintsLayer(m, "")).toBe(false);
    expect(m.calls).toEqual([]);
  });

  it("adds the source and a 3D layer once, and never twice", () => {
    const m = fakeMap();
    expect(addFootprintsLayer(m, "/data/keffi-buildings.geojson")).toBe(true);
    expect(m.calls).toEqual(["source:footprints", `layer:${FOOTPRINT_LAYER}`]);
    expect(addFootprintsLayer(m, "/data/keffi-buildings.geojson")).toBe(false);
  });

  it("never throws if the map is not ready", () => {
    const early = { getSource: () => { throw new Error("no style"); }, addSource: () => undefined, addLayer: () => undefined };
    expect(addFootprintsLayer(early, "/x.geojson")).toBe(false);
  });
});
