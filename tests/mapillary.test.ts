import { describe, expect, it, vi } from "vitest";

import { nearbyStreetPhotos } from "@/lib/maps/mapillary";

const reply = (data: unknown[]) => vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200 }));

describe("nearbyStreetPhotos", () => {
  it("returns the closest photos first, with a link to Mapillary's viewer", async () => {
    const fetchImpl = reply([
      { id: "far", thumb_1024_url: "https://img/far.jpg", captured_at: Date.UTC(2023, 5, 1), computed_geometry: { coordinates: [7.8745, 8.8465] } },
      { id: "near", thumb_1024_url: "https://img/near.jpg", captured_at: Date.UTC(2024, 1, 1), computed_geometry: { coordinates: [7.87371, 8.84651] } },
      { id: "broken", computed_geometry: { coordinates: [7.8737, 8.8465] } }, // no picture: skipped
    ]);
    const photos = await nearbyStreetPhotos(8.8465, 7.8737, { token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(photos.map((p) => p.id)).toEqual(["near", "far"]);
    expect(photos[0].viewerUrl).toBe("https://www.mapillary.com/app/?pKey=near&focus=photo");
    expect(photos[0].capturedAt).toBe("2024-02-01T00:00:00.000Z");
    const asked = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(asked).toContain("graph.mapillary.com/images");
    expect(asked).toContain("bbox=");
  });

  it("returns nothing, instead of failing, without a token or when Mapillary cannot be reached", async () => {
    expect(await nearbyStreetPhotos(8.8, 7.8, { token: "" })).toEqual([]);
    const down = vi.fn(async () => { throw new Error("offline"); });
    expect(await nearbyStreetPhotos(8.8, 7.8, { token: "t", fetchImpl: down as unknown as typeof fetch })).toEqual([]);
    const refused = vi.fn(async () => new Response("no", { status: 401 }));
    expect(await nearbyStreetPhotos(8.8, 7.8, { token: "t", fetchImpl: refused as unknown as typeof fetch })).toEqual([]);
  });
});
