import { afterEach, describe, expect, it, vi } from "vitest";

import { resetWebglCache, webglSupported } from "@/lib/maps/webgl";
import { pickEngine } from "@/lib/maps/engine";

afterEach(() => {
  vi.unstubAllGlobals();
  resetWebglCache();
});

const canvasWith = (ctx: unknown) => vi.stubGlobal("document", { createElement: () => ({ getContext: () => ctx }) });

describe("WebGL detection", () => {
  it("is false when the browser gives no WebGL context", () => {
    canvasWith(null);
    expect(webglSupported()).toBe(false);
    resetWebglCache();
    expect(pickEngine()).toBe("2d");
  });

  it("is false when the context call throws or the context is lost", () => {
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => { throw new Error("blocked"); } }) });
    expect(webglSupported()).toBe(false);
    resetWebglCache();
    canvasWith({ createShader: () => ({}), isContextLost: () => true });
    expect(webglSupported()).toBe(false);
  });

  it("is true with a working context, and picks the 3D map", () => {
    canvasWith({ createShader: () => ({}), isContextLost: () => false });
    expect(webglSupported()).toBe(true);
    expect(pickEngine()).toBe("webgl");
  });
});
