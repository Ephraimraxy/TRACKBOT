import { afterEach, describe, expect, it } from "vitest";

import { ESRI_SATELLITE, imageryFallback, pickSatellite } from "@/lib/config/mapLayers";
import { fallBackToEsri, imageryFailed, zoomCapFor } from "@/lib/maps/styles";
import { smoothTrail, TRAIL_MIN_METRES } from "@/lib/maps/trail";

afterEach(() => imageryFallback.reset());

describe("choosing the satellite provider", () => {
  it("uses free Esri with no keys", () => {
    expect(pickSatellite({}).name).toBe("esri");
    expect(pickSatellite({ mapbox: "  ", maptiler: "" }).name).toBe("esri");
  });

  it("by default prefers Mapbox over MapTiler when both are set (the order in Railway does not matter)", () => {
    expect(pickSatellite({ mapbox: "pk.x", maptiler: "k" }).name).toBe("mapbox");
    expect(pickSatellite({ maptiler: "k" }).name).toBe("maptiler");
  });

  it("lets NEXT_PUBLIC_MAP_PROVIDER choose, but only a provider whose key exists", () => {
    expect(pickSatellite({ mapbox: "pk.x", maptiler: "k", provider: "maptiler" }).name).toBe("maptiler");
    expect(pickSatellite({ mapbox: "pk.x", maptiler: "k", provider: "MapBox " }).name).toBe("mapbox");
    expect(pickSatellite({ mapbox: "pk.x", maptiler: "k", provider: "esri" }).name).toBe("esri");
    expect(pickSatellite({ maptiler: "k", provider: "mapbox" }).name).toBe("maptiler"); // no Mapbox key: falls back to what exists
    expect(pickSatellite({ mapbox: "pk.x", provider: "nonsense" }).name).toBe("mapbox");
  });

  it("keeps the key in the tile address and adds Esri labels only where the provider has none", () => {
    expect(pickSatellite({ maptiler: "KEY1" }).layer.url).toContain("key=KEY1");
    expect(pickSatellite({ mapbox: "pk.T" }).layer.url).toContain("access_token=pk.T");
    expect(pickSatellite({ mapbox: "pk.T" }).labels).toBeNull();
    expect(pickSatellite({ maptiler: "k" }).labels).not.toBeNull();
  });
});

describe("zoom limits (no zooming into a blur)", () => {
  it("every provider stops one level past its real pictures", () => {
    for (const p of [pickSatellite({}), pickSatellite({ maptiler: "k" }), pickSatellite({ mapbox: "pk.x" })]) {
      expect(p.layer.maxZoom).toBe(p.layer.maxNativeZoom + 1);
    }
    expect(ESRI_SATELLITE.maxZoom).toBe(19);
  });

  it("for the 3D map the cap allows for 512-pixel tiles", () => {
    expect(zoomCapFor(pickSatellite({ mapbox: "pk.x" }).layer)).toBe(21); // 22 with a one-level tile offset
    expect(zoomCapFor(ESRI_SATELLITE)).toBe(19);
  });
});

describe("falling back to Esri when the key stops working", () => {
  const map = () => {
    const calls: string[] = [];
    let zoom = 21;
    return { calls, setStyle: () => calls.push("style"), setMaxZoom: (z: number) => calls.push(`max${z}`), getZoom: () => zoom, setZoom: (z: number) => { zoom = z; calls.push(`zoom${z}`); } };
  };

  it("recognises a refused satellite request, and nothing else", () => {
    expect(imageryFailed({ sourceId: "imagery", error: { status: 429 } })).toBe(true);
    expect(imageryFailed({ sourceId: "imagery", error: { status: 401 } })).toBe(true);
    expect(imageryFailed({ sourceId: "imagery", error: { status: 404 } })).toBe(false); // one missing tile is normal
    expect(imageryFailed({ sourceId: "openmaptiles", error: { status: 429 } })).toBe(false);
    expect(imageryFailed(null)).toBe(false);
  });

  it("does nothing when already on Esri (there is nothing to fall back to)", () => {
    const m = map();
    expect(fallBackToEsri(m)).toBe(false);
    expect(m.calls).toEqual([]);
  });
});

describe("tidying the route driven", () => {
  const pt = (lngSteps: number, latSteps = 0) => ({ latitude: 8.84 + latSteps * 0.00001, longitude: 7.87 + lngSteps * 0.00001 });

  it("drops the wobble of a phone standing still, keeping the start and the end", () => {
    const wobble = [pt(0), pt(1, 1), pt(0, 1), pt(1), pt(0), pt(1, 1)]; // all within a couple of metres
    const out = smoothTrail(wobble);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(wobble[0]);
    expect(out[1]).toBe(wobble[5]);
  });

  it("keeps real movement", () => {
    const drive = [0, 20, 40, 60, 80].map((n) => pt(n)); // ~22 m apart
    expect(smoothTrail(drive)).toHaveLength(5);
    expect(TRAIL_MIN_METRES).toBeGreaterThan(5);
  });

  it("leaves short lines alone", () => {
    expect(smoothTrail([])).toEqual([]);
    const two = [pt(0), pt(1)];
    expect(smoothTrail(two)).toBe(two);
  });
});

import { vi } from "vitest";

describe("the switch itself, with a key configured", () => {
  it("moves a map to Esri once, lowers its zoom limit, and later maps start on Esri", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "pk.test");
    vi.resetModules();
    const layers = await import("@/lib/config/mapLayers");
    const styles = await import("@/lib/maps/styles");
    expect(layers.SATELLITE_PROVIDER).toBe("mapbox");
    expect(styles.maxZoomNow()).toBe(21);

    const calls: string[] = [];
    let zoom = 21;
    const map = { setStyle: () => calls.push("style"), setMaxZoom: (z: number) => calls.push(`max${z}`), getZoom: () => zoom, setZoom: (z: number) => { zoom = z; calls.push(`zoom${z}`); } };
    expect(styles.fallBackToEsri(map)).toBe(true);
    expect(calls).toEqual(["style", "max19", "zoom19"]);
    expect(layers.currentSatellite().url).toContain("arcgisonline");
    expect(styles.maxZoomNow()).toBe(19); // a map created after the switch is limited to Esri's pictures
    expect(JSON.stringify(styles.satelliteStyle())).toContain("arcgisonline");
    expect(styles.fallBackToEsri(map)).toBe(false); // once per visit
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("tidying the route with each fix's own accuracy", () => {
  const at = (metresEast: number, accuracy: number | null) => ({ latitude: 8.84, longitude: 7.87 + metresEast / 111_000, accuracy });

  it("drops moves smaller than the fix's own accuracy circle (the phone cannot tell it moved)", () => {
    const pts = [at(0, 5), at(25, 40), at(30, 40), at(35, 40), at(200, 5)]; // 25-35 m moves with ±40 m accuracy
    const out = smoothTrail(pts);
    expect(out).toHaveLength(2 + 0); // start and end only: nothing in between is a real move
  });

  it("keeps a move bigger than the accuracy, and caps a very vague fix so it cannot hide a real drive", () => {
    expect(smoothTrail([at(0, 5), at(60, 20), at(130, 20), at(200, 5)])).toHaveLength(4);
    expect(smoothTrail([at(0, 5), at(70, 900), at(200, 5)])).toHaveLength(3); // 70 m > the 50 m cap
  });
});
