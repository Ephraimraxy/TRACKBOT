import { webglSupported } from "@/lib/maps/webgl";

/**
 * Which map engine to use: the 3D one (WebGL) or the flat 2D one. `?map=2d` forces the 2D map, which is also what
 * a person on a very weak device can use, and what the tests use.
 */
export type MapEngine = "webgl" | "2d";

export function pickEngine(): MapEngine {
  try {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("map") === "2d") return "2d";
  } catch {
    /* ignore */
  }
  return webglSupported() ? "webgl" : "2d";
}
