/**
 * Which routing service works out road routes, and whether it may be used here.
 *
 *   ROUTING_PROVIDER   "osrm" (default) or "mapbox" or "none"
 *   ROUTING_BASE_URL   osrm only: the address of an OSRM-compatible server. Defaults to the PUBLIC DEMO server, which is
 *                      fine for development but is not for production: it has no service guarantee and its operators
 *                      forbid heavy or commercial use (see docs/routing-provider.md).
 *   ROUTING_API_KEY    mapbox only: a server-side access token (never a NEXT_PUBLIC_ variable).
 *   ROUTING_ALLOW_PUBLIC_DEMO=true  lets a production server use the public demo anyway (for a short pilot).
 *
 * When routing is not usable the application does not guess: it shows a straight-line estimate, clearly marked as
 * one, and never gives turn-by-turn directions (see lib/services/etaService.ts and lib/services/routeService.ts).
 */
export type RoutingProvider = "osrm" | "mapbox" | "none";

export const PUBLIC_OSRM_DEMO = "https://router.project-osrm.org";
export const MAPBOX_DIRECTIONS = "https://api.mapbox.com/directions/v5/mapbox/driving";

export interface RoutingConfig {
  provider: RoutingProvider;
  /** For osrm: the server address with no trailing slash. For mapbox: the fixed Directions API address. */
  baseUrl: string;
  apiKey?: string;
  /** True when a request may be sent. */
  usable: boolean;
  /** Why not, in words an operator can act on. */
  reason?: string;
  isPublicDemo: boolean;
}

export function resolveRouting(env: Record<string, string | undefined> = process.env): RoutingConfig {
  const requested = (env.ROUTING_PROVIDER ?? "osrm").trim().toLowerCase();
  const production = env.NODE_ENV === "production";

  if (requested === "none") {
    return { provider: "none", baseUrl: "", usable: false, reason: "Routing is switched off (ROUTING_PROVIDER=none).", isPublicDemo: false };
  }

  if (requested === "mapbox") {
    const apiKey = env.ROUTING_API_KEY?.trim();
    if (!apiKey) {
      return { provider: "mapbox", baseUrl: MAPBOX_DIRECTIONS, usable: false, reason: "ROUTING_PROVIDER=mapbox needs ROUTING_API_KEY (a server-side Mapbox access token).", isPublicDemo: false };
    }
    return { provider: "mapbox", baseUrl: MAPBOX_DIRECTIONS, apiKey, usable: true, isPublicDemo: false };
  }

  const baseUrl = (env.ROUTING_BASE_URL?.trim() || PUBLIC_OSRM_DEMO).replace(/\/+$/, "");
  const isPublicDemo = baseUrl.includes("router.project-osrm.org");
  if (isPublicDemo && production && env.ROUTING_ALLOW_PUBLIC_DEMO !== "true") {
    return {
      provider: "osrm",
      baseUrl,
      usable: false,
      reason:
        "The public OSRM demo server is not for production use (no service guarantee, heavy and commercial use forbidden). " +
        "Set ROUTING_BASE_URL to your own OSRM server, or ROUTING_PROVIDER=mapbox with ROUTING_API_KEY. See docs/routing-provider.md.",
      isPublicDemo,
    };
  }
  return { provider: "osrm", baseUrl, usable: true, isPublicDemo };
}

/** The request address for a route between two points, for the configured provider. */
export function routeUrl(config: RoutingConfig, from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }, detailed: boolean): string {
  const coords = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  const query = detailed ? "overview=full&geometries=geojson&steps=true" : "overview=false";
  if (config.provider === "mapbox") {
    return `${config.baseUrl}/${coords}?${detailed ? query : "overview=false"}&access_token=${encodeURIComponent(config.apiKey ?? "")}`;
  }
  return `${config.baseUrl}/route/v1/driving/${coords}?${query}`;
}
