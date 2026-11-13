import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { CATALOG } from "@/lib/seed/catalogData";
import { seedCatalog } from "@/lib/seed/seedCatalog";
import insertCategories from "@/lib/seed/insertCategories";
import insertColors from "@/lib/seed/insertColors";
import insertGenders from "@/lib/seed/insertGenders";
import insertSizes from "@/lib/seed/insertSizes";
import { db, resetDb } from "./helpers";

// A stand-in for image storage: records what was stored and deleted.
function fakeStorage() {
  const stored: string[] = [];
  const deleted: string[] = [];
  return {
    stored,
    deleted,
    async uploadImage(_file: File, folder: string) {
      const key = `${folder}/img-${stored.length + 1}.jpg`;
      stored.push(key);
      return { key };
    },
    async deleteImage(key: string) {
      deleted.push(key);
    },
  };
}
const photo = async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeEach(async () => {
  await resetDb();
  await insertCategories();
  await insertGenders();
  await insertColors();
  await insertSizes();
});
afterAll(() => db.$disconnect());

describe("catalogue data", () => {
  it("has 23 categories with exactly 6 products each", () => {
    const counts = new Map<string, number>();
    for (const p of CATALOG) counts.set(p.categorie, (counts.get(p.categorie) ?? 0) + 1);
    expect(counts.size).toBe(23);
    expect([...counts.values()].every((n) => n === 6)).toBe(true);
    expect(CATALOG).toHaveLength(138);
  });

  it("has unique names and unique photos", () => {
    expect(new Set(CATALOG.map((p) => p.nom)).size).toBe(138);
    expect(new Set(CATALOG.map((p) => p.photo)).size).toBe(138);
  });

  it("fits the database columns and has sensible prices and stock", () => {
    for (const p of CATALOG) {
      expect(p.nom.length).toBeLessThanOrEqual(100);
      expect(p.objet.length).toBeLessThanOrEqual(255);
      expect(p.description.length).toBeLessThanOrEqual(1000);
      expect(Number.isInteger(p.prix) && p.prix >= 500 && p.prix <= 1_000_000).toBe(true);
      expect(p.stock).toBeGreaterThan(0);
      expect(p.tailles.length).toBeGreaterThan(0);
      expect(p.photo).toMatch(/^photo-[0-9]+-[0-9a-f]+$/);
    }
  });

  it("only uses categories, genders, colours and sizes that exist in the shop", async () => {
    const [cats, gens, cols, sizes] = await Promise.all([
      db.categorie.findMany(), db.genre.findMany(), db.couleur.findMany(), db.taille.findMany(),
    ]);
    const has = (rows: { nom: string }[]) => new Set(rows.map((r) => r.nom));
    for (const p of CATALOG) {
      expect(has(cats).has(p.categorie), `${p.nom}: category ${p.categorie}`).toBe(true);
      if (p.genre) expect(has(gens).has(p.genre), `${p.nom}: gender ${p.genre}`).toBe(true);
      for (const c of p.couleurs) expect(has(cols).has(c), `${p.nom}: colour ${c}`).toBe(true);
      for (const s of p.tailles) expect(has(sizes).has(s), `${p.nom}: size ${s}`).toBe(true);
    }
  });

  it("does not put brand names in product names", () => {
    const brands = /\b(nike|adidas|puma|levi|levis|gucci|rolex|omega|birkenstock|veja|dior|zara|apple|iphone|ipad|samsung|huawei|sony|jbl|canon|nikon|lego|singer|ryobi|dewalt|stanley|bosch|philips|lg)\b/i;
    for (const p of CATALOG) expect(p.nom + p.objet + p.description).not.toMatch(brands);
  });
});

describe("seedCatalog", () => {
  it("creates every product as a shop product with one stored photo", async () => {
    const storage = fakeStorage();
    const result = await seedCatalog({ db, storage, fetchImage: photo });

    expect(result.created).toHaveLength(138);
    expect(result.failed).toEqual([]);
    expect(storage.stored).toHaveLength(138);

    const products = await db.produit.findMany({ include: { images: true, produitBoutique: true, categorie: true, couleurs: true, tailles: true } });
    expect(products).toHaveLength(138);
    for (const p of products) {
      expect(p.images).toHaveLength(1);
      expect(p.images[0].imagePublicId).toMatch(/^products\//);
      expect(p.produitBoutique).not.toBeNull();
      expect(p.tailles.length).toBeGreaterThan(0);
      expect(Number(p.prix)).toBeGreaterThan(0);
    }
    const perCategory = new Map<string, number>();
    for (const p of products) perCategory.set(p.categorie!.nom, (perCategory.get(p.categorie!.nom) ?? 0) + 1);
    expect([...perCategory.values()]).toEqual(Array(23).fill(6));
  });

  it("is safe to run again: nothing duplicated, the owner's edits and deletions are kept", async () => {
    const storage = fakeStorage();
    await seedCatalog({ db, storage, fetchImage: photo });

    await db.produit.update({ where: { id: (await db.produit.findFirstOrThrow({ where: { nom: "Black Leggings" } })).id }, data: { prix: 11111 } });
    await db.produit.delete({ where: { id: (await db.produit.findFirstOrThrow({ where: { nom: "Compact Black Umbrella" } })).id } });

    const again = await seedCatalog({ db, storage, fetchImage: photo });
    // Only the deleted product comes back by name; the edited one is untouched.
    expect(again.created).toEqual(["Compact Black Umbrella"]);
    expect(again.skipped).toHaveLength(137);
    expect(Number((await db.produit.findFirstOrThrow({ where: { nom: "Black Leggings" } })).prix)).toBe(11111);
    expect(await db.produit.count()).toBe(138);
  });

  it("reports a product whose photo cannot be fetched and carries on with the rest", async () => {
    const storage = fakeStorage();
    const bad = CATALOG[3].photo;
    const result = await seedCatalog({
      db,
      storage,
      fetchImage: async (id) => {
        if (id === bad) throw new Error("HTTP 404");
        return photo();
      },
    });
    expect(result.created).toHaveLength(137);
    expect(result.failed).toEqual([{ nom: CATALOG[3].nom, reason: "HTTP 404" }]);
    expect(storage.stored).toHaveLength(137); // nothing stored for the failed one
    expect(await db.produit.count({ where: { nom: CATALOG[3].nom } })).toBe(0);
  });

  it("removes a stored photo again if the product could not be saved", async () => {
    const storage = fakeStorage();
    const broken = { ...CATALOG[0], nom: "Broken", categorie: "Tops", prix: 10 ** 12 }; // overflows the price column
    const result = await seedCatalog({ db, storage, fetchImage: photo }, [broken]);
    expect(result.failed).toHaveLength(1);
    expect(storage.deleted).toEqual(storage.stored);
    expect(await db.produit.count()).toBe(0);
  });

  it("reports an unknown category instead of creating a half-filled product", async () => {
    const storage = fakeStorage();
    const result = await seedCatalog({ db, storage, fetchImage: photo }, [{ ...CATALOG[0], nom: "Odd", categorie: "Nope" }]);
    expect(result.failed[0].reason).toContain('Category "Nope"');
    expect(storage.stored).toEqual([]);
  });
});

describe("catalogue search by gender", () => {
  it("shows unisex items under Men and Women, but not the other gender's items", async () => {
    await seedCatalog({ db, storage: fakeStorage(), fetchImage: photo });
    const { GET } = await import("@/app/api/products/search/route");
    const { NextRequest } = await import("next/server");

    const search = async (query: string) => {
      const res = await GET(new NextRequest(`http://localhost/api/products/search?${query}&pageSize=200`));
      return (await res.json()).data as { nom: string; genre: { nom: string } | null }[];
    };

    const men = await search("gender=Men");
    const names = new Set(men.map((p) => p.genre?.nom));
    expect(names.has("Men")).toBe(true);
    expect(names.has("Unisex")).toBe(true);
    expect(names.has("Women")).toBe(false);

    // Every clothing-style category stays reachable after choosing a gender.
    expect((await search("gender=Women&category=Other")).length).toBeGreaterThan(0);
    // Children is not widened.
    expect((await search("gender=Children")).every((p) => p.genre?.nom === "Children")).toBe(true);
  });
});
