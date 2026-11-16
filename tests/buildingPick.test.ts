import { describe, expect, it } from "vitest";

import { pickBuilding, polygonContains, ringContains } from "@/lib/maps/buildingPick";

// Squares about 22 m wide near Keffi (0.0002 degrees). [lng, lat]
const square = (lng: number, lat: number, size = 0.0002): [number, number][] => [[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]];
const poly = (...rings: [number, number][][]) => ({ geometry: { type: "Polygon" as const, coordinates: rings }, properties: {} });
const at = (lng: number, lat: number) => ({ longitude: lng, latitude: lat });

describe("which building is the pin on", () => {
  it("point in polygon: inside, outside and on a concave shape", () => {
    const r = square(7.87, 8.84);
    expect(ringContains(r, 7.8701, 8.8401)).toBe(true);
    expect(ringContains(r, 7.8705, 8.8401)).toBe(false);
    const L: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0]];
    expect(ringContains(L, 0.5, 1.5)).toBe(true);
    expect(ringContains(L, 1.5, 1.5)).toBe(false); // the notch of the L
  });

  it("a courtyard (hole) is not part of the building", () => {
    const outer = square(7.87, 8.84, 0.0006);
    const hole = square(7.8702, 8.8402, 0.0002);
    expect(polygonContains([outer, hole], 7.87005, 8.84005)).toBe(true);
    expect(polygonContains([outer, hole], 7.8703, 8.8403)).toBe(false);
  });

  it("picks the building that CONTAINS the pin, not a neighbour that happens to be listed first", () => {
    const neighbour = poly(square(7.8695, 8.84)); // listed first, a few metres west
    const house = poly(square(7.87, 8.84));
    const picked = pickBuilding([neighbour, house], at(7.8701, 8.8401));
    expect(picked?.feature).toBe(house);
    expect(picked?.how).toBe("contains");
  });

  it("prefers the innermost of nested buildings", () => {
    const compound = poly(square(7.87, 8.84, 0.001));
    const house = poly(square(7.8702, 8.8402, 0.0002));
    expect(pickBuilding([compound, house], at(7.87025, 8.84025))?.feature).toBe(house);
    expect(pickBuilding([compound, house], at(7.8708, 8.8408))?.feature).toBe(compound);
  });

  it("a pin just outside every building picks the nearest wall within a few metres", () => {
    const house = poly(square(7.87, 8.84));
    const picked = pickBuilding([house], at(7.87 - 0.00004, 8.8401)); // ~4 m west of the wall
    expect(picked?.how).toBe("nearest");
    expect(picked?.distanceMetres).toBeGreaterThan(2);
    expect(picked?.distanceMetres).toBeLessThan(8);
  });

  it("picks nothing rather than the wrong house when the pin is far from every building", () => {
    expect(pickBuilding([poly(square(7.87, 8.84))], at(7.8712, 8.8412))).toBeNull(); // >100 m away
    expect(pickBuilding([], at(7.87, 8.84))).toBeNull();
  });

  it("handles MultiPolygon buildings and ignores degenerate shapes", () => {
    const multi = { geometry: { type: "MultiPolygon" as const, coordinates: [[square(7.88, 8.85)], [square(7.87, 8.84)]] }, properties: {} };
    expect(pickBuilding([multi], at(7.8701, 8.8401))?.how).toBe("contains");
    const junk = { geometry: { type: "Polygon" as const, coordinates: [[[7.87, 8.84], [7.87, 8.84]] as [number, number][]] }, properties: {} };
    expect(pickBuilding([junk], at(7.87, 8.84))).toBeNull();
  });
});
