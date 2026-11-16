"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";

import { T } from "@/components/i18n/T";
import { mapillaryEnabled, nearbyStreetPhotos, type StreetPhoto } from "@/lib/maps/mapillary";

/**
 * Street-level photos taken near a point (the customer's spot), so the delivery person can recognise the road,
 * the entrance and the landmarks before arriving. Shown only when a Mapillary token is configured.
 */
export default function StreetPhotos({ latitude, longitude, title = "Street photos near the delivery spot" }: { latitude: number; longitude: number; title?: string }) {
  const [photos, setPhotos] = useState<StreetPhoto[] | null>(null);

  useEffect(() => {
    if (!mapillaryEnabled) return;
    let cancelled = false;
    nearbyStreetPhotos(latitude, longitude).then((p) => !cancelled && setPhotos(p));
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude]);

  if (!mapillaryEnabled || photos === null) return null;

  return (
    <section className="mt-4 rounded-lg border bg-white p-3">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Camera className="h-4 w-4" />
        <T>{title}</T>
      </h3>
      {photos.length === 0 ? (
        <p className="text-xs text-gray-600">
          <T>No street photos have been taken near this spot yet.</T>
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p) => (
            <a key={p.id} href={p.viewerUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="Street view" loading="lazy" className="h-28 w-44 rounded object-cover" />
              <span className="mt-0.5 block text-[10px] text-gray-500">
                {p.distanceMetres} m · {p.capturedAt ? new Date(p.capturedAt).getFullYear() : ""}
              </span>
            </a>
          ))}
        </div>
      )}
      <p className="mt-1 text-[10px] text-gray-500">Photos © Mapillary contributors, CC BY-SA</p>
    </section>
  );
}
