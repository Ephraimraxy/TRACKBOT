import { describe, expect, it } from "vitest";

import { buildHeroSlots, type HeroProduct } from "@/lib/utils/heroSlots";

/** A small shop: `perCategory` products in each named category. */
function shop(categories: string[], perCategory = 6): HeroProduct[] {
  return categories.flatMap((c) =>
    Array.from({ length: perCategory }, (_, i) => ({
      id: `${c}-${i}`,
      categorie: { nom: c },
      images: [{ imagePublicId: `products/${c}-${i}.jpg` }],
    }))
  );
}

/** A repeatable "random": the same sequence every time. */
function seeded(seed = 1) {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

const CATS = ["Tops", "Footwear", "Groceries", "Computing", "Toys", "Garden", "Fabrics", "Beauty"];

describe("homepage hero rotation", () => {
  it("gives every card in a set a different category", () => {
    for (const slot of buildHeroSlots(shop(CATS), { random: seeded(3) })) {
      expect(slot).toHaveLength(4);
      expect(new Set(slot.map((p) => p.categorie!.nom)).size).toBe(4);
    }
  });

  it("covers the whole shop: every category shows up as the rotation goes round", () => {
    const seen = new Set(buildHeroSlots(shop(CATS), { random: seeded(7) }).flat().map((p) => p.categorie!.nom));
    expect([...seen].sort()).toEqual([...CATS].sort());
  });

  it("does not keep repeating the same product: it moves on to the next one of a category", () => {
    const ids = buildHeroSlots(shop(CATS), { slots: 16, random: seeded(5) }).flat().map((p) => p.id);
    // 16 sets of 4 over 8 categories: each category comes up 8 times, with 6 products each.
    const perCategory = new Map<string, Set<string>>();
    for (const id of ids) {
      const c = id.split("-")[0];
      perCategory.set(c, (perCategory.get(c) ?? new Set()).add(id));
    }
    for (const set of perCategory.values()) expect(set.size).toBe(6);
  });

  it("changes between sets", () => {
    const slots = buildHeroSlots(shop(CATS), { random: seeded(2) });
    const keys = slots.map((s) => s.map((p) => p.id).join(","));
    expect(new Set(keys).size).toBeGreaterThan(1);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("skips products with no photo", () => {
    const products = [
      ...shop(["Tops", "Toys", "Garden", "Fabrics"], 2),
      { id: "bare", categorie: { nom: "Tops" }, images: [] },
    ];
    const ids = buildHeroSlots(products, { random: seeded(4) }).flat().map((p) => p.id);
    expect(ids).not.toContain("bare");
  });

  it("copes with a tiny or empty shop", () => {
    expect(buildHeroSlots([])).toEqual([]);
    expect(buildHeroSlots([{ id: "only", categorie: null, images: [] }])).toEqual([]);

    const one = buildHeroSlots(shop(["Tops"], 1), { random: seeded(1) });
    expect(one.every((slot) => slot.length === 1 && slot[0].id === "Tops-0")).toBe(true); // no card shown twice

    const two = buildHeroSlots(shop(["Tops", "Toys"], 3), { random: seeded(1) });
    for (const slot of two) expect(new Set(slot.map((p) => p.id)).size).toBe(slot.length);
  });
});
