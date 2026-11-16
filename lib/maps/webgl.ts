/**
 * Can this browser draw a WebGL map? Some phones, locked-down browsers, remote desktops and old devices cannot.
 * The 3D map needs WebGL; without it the page shows a flat 2D map instead, which needs no WebGL.
 */
let cached: boolean | null = null;

export function webglSupported(): boolean {
  if (cached !== null) return cached;
  if (typeof document === "undefined") return false; // server render: decided again in the browser
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    cached = !!gl && typeof gl.createShader === "function" && !gl.isContextLost();
  } catch {
    cached = false;
  }
  return cached;
}

/** For tests. */
export function resetWebglCache() {
  cached = null;
}
