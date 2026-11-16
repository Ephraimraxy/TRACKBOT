import { describe, expect, it, vi } from "vitest";

import { MAPBOX_DIRECTIONS, PUBLIC_OSRM_DEMO, resolveRouting, routeUrl } from "@/lib/config/routing";
import { estimateRoute, planRoute } from "@/lib/services/etaService";
import { validateEnv } from "@/lib/config/env";

const A = { latitude: 8.84, longitude: 7.87 };
const B = { latitude: 8.852, longitude: 7.879 };
const ok = () => vi.fn(async () => new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 1200, duration: 300, geometry: { coordinates: [[7.87, 8.84], [7.879, 8.852]] }, legs: [{ steps: [{ distance: 1200, name: "Zaria Road", maneuver: { type: "depart" } }] }] }] }), { status: 200 }));

describe("resolveRouting", () => {
  it("uses the public OSRM demo outside production, flagged as a demo", () => {
    const r = resolveRouting({ NODE_ENV: "development" } as never);
    expect(r).toMatchObject({ provider: "osrm", baseUrl: PUBLIC_OSRM_DEMO, usable: true, isPublicDemo: true });
  });

  it("refuses the public demo in production unless explicitly allowed", () => {
    const r = resolveRouting({ NODE_ENV: "production" } as never);
    expect(r.usable).toBe(false);
    expect(r.reason).toMatch(/demo/i);
    expect(resolveRouting({ NODE_ENV: "production", ROUTING_ALLOW_PUBLIC_DEMO: "true" } as never).usable).toBe(true);
  });

  it("accepts a self-hosted OSRM in production", () => {
    const r = resolveRouting({ NODE_ENV: "production", ROUTING_PROVIDER: "osrm", ROUTING_BASE_URL: "https://osrm.example.com/" } as never);
    expect(r).toMatchObject({ provider: "osrm", baseUrl: "https://osrm.example.com", usable: true, isPublicDemo: false });
  });

  it("needs a key for Mapbox, and is unusable without one", () => {
    expect(resolveRouting({ NODE_ENV: "production", ROUTING_PROVIDER: "mapbox" } as never).usable).toBe(false);
    const r = resolveRouting({ NODE_ENV: "production", ROUTING_PROVIDER: "mapbox", ROUTING_API_KEY: "pk.test" } as never);
    expect(r).toMatchObject({ provider: "mapbox", usable: true });
  });

  it("can be switched off", () => {
    expect(resolveRouting({ ROUTING_PROVIDER: "none" } as never).usable).toBe(false);
  });

  it("builds the right request for each provider", () => {
    const osrm = routeUrl(resolveRouting({ NODE_ENV: "development" } as never), A, B, true);
    expect(osrm).toContain("/route/v1/driving/7.87,8.84;7.879,8.852");
    expect(osrm).toContain("steps=true");
    const mb = routeUrl(resolveRouting({ ROUTING_PROVIDER: "mapbox", ROUTING_API_KEY: "pk.test" } as never), A, B, true);
    expect(mb.startsWith(MAPBOX_DIRECTIONS)).toBe(true);
    expect(mb).toContain("access_token=pk.test");
  });
});

describe("route requests honour the routing configuration", () => {
  it("does not call the network at all when routing is unusable, and says why", async () => {
    const fetchImpl = vi.fn();
    const cfg = resolveRouting({ NODE_ENV: "production" } as never);
    const plan = await planRoute(A, B, fetchImpl as unknown as typeof fetch, cfg);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(plan.source).toBe("estimate");
    expect(plan.steps).toEqual([]);
    expect(plan.fallbackReason).toBe("not_configured");
    expect((await estimateRoute(A, B, fetchImpl as unknown as typeof fetch, cfg)).source).toBe("estimate");
  });

  it("returns a road plan when the provider answers", async () => {
    const plan = await planRoute(A, B, ok() as unknown as typeof fetch, resolveRouting({ NODE_ENV: "development" } as never));
    expect(plan.source).toBe("route");
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it("falls back to an estimate on a provider error status, bad body or network failure", async () => {
    const cfg = resolveRouting({ NODE_ENV: "development" } as never);
    for (const impl of [
      vi.fn(async () => new Response("no", { status: 429 })),
      vi.fn(async () => new Response(JSON.stringify({ code: "NoRoute", routes: [] }), { status: 200 })),
      vi.fn(async () => { throw new Error("offline"); }),
    ]) {
      const plan = await planRoute(A, B, impl as unknown as typeof fetch, cfg);
      expect(plan.source).toBe("estimate");
      expect(plan.steps).toEqual([]);
      expect(plan.fallbackReason).toBeTruthy();
    }
  });
});

describe("environment check", () => {
  it("warns that road routing is unavailable in production without a provider", () => {
    const { warnings } = validateEnv({ NODE_ENV: "production", DATABASE_URL: "postgresql://x", AUTH_SECRET: "x".repeat(40) } as never);
    expect(warnings.some((w) => /Road routing is not available/.test(w))).toBe(true);
  });
});
