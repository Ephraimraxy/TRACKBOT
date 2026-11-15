"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

import MapBoundary from "@/components/tracking/MapBoundary";
import { pickEngine, type MapEngine } from "@/lib/maps/engine";

const Loading = () => <div className="h-64 w-full animate-pulse rounded-xl border bg-gray-100" />;
const Map3D = dynamic(() => import("@/components/tracking/DestinationMap"), { ssr: false, loading: Loading });
const Map2D = dynamic(() => import("@/components/tracking/DestinationMap2D"), { ssr: false, loading: Loading });

/** The delivery-address map: 3D where WebGL works, flat 2D where it does not (or if the 3D one fails). */
export default function AdaptiveDestinationMap(props: { latitude: number; longitude: number; className?: string }) {
  const [engine, setEngine] = useState<MapEngine | null>(null);
  useEffect(() => setEngine(pickEngine()), []);
  if (!engine) return <Loading />;
  if (engine === "2d") return <Map2D {...props} />;
  return (
    <MapBoundary fallback={() => <Map2D {...props} />} onError={() => setEngine("2d")}>
      <Map3D {...props} onUnsupported={() => setEngine("2d")} />
    </MapBoundary>
  );
}
