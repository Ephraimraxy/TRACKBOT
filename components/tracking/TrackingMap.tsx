"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

import MapBoundary from "@/components/tracking/MapBoundary";
import type { MapPoint, MapPosition } from "@/components/tracking/LiveMap";
import { pickEngine, type MapEngine } from "@/lib/maps/engine";

const Loading = ({ className = "h-72" }: { className?: string }) => <div className={`w-full animate-pulse rounded border bg-gray-100 ${className}`} />;
const Map3D = dynamic(() => import("@/components/tracking/LiveMap"), { ssr: false, loading: () => <Loading /> });
const Map2D = dynamic(() => import("@/components/tracking/LiveMap2D"), { ssr: false, loading: () => <Loading /> });

export interface TrackingMapProps {
  position: MapPosition;
  trail?: MapPoint[];
  destination?: MapPoint | null;
  plannedRoute?: [number, number][] | null;
  /** "road": a route along real roads. "estimate": a straight line, drawn dotted and never presented as a road. */
  routeKind?: "road" | "estimate" | null;
  rerouted?: boolean;
  live?: boolean;
  className?: string;
}

/**
 * The live map. It uses the 3D map where the browser has WebGL and a flat 2D map where it does not, and drops to the
 * 2D map if the 3D one fails for any reason (no WebGL context, driver trouble, a map error), so there is always a map.
 */
export default function TrackingMap(props: TrackingMapProps) {
  const [engine, setEngine] = useState<MapEngine | null>(null);
  useEffect(() => setEngine(pickEngine()), []);
  if (!engine) return <Loading className={props.className} />;
  const flat = <Map2D {...props} />;
  if (engine === "2d") return flat;
  return (
    <MapBoundary fallback={() => flat} onError={() => setEngine("2d")}>
      <Map3D {...props} onUnsupported={() => setEngine("2d")} />
    </MapBoundary>
  );
}
