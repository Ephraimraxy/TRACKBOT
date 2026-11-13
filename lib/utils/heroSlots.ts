export interface HeroProduct {
  id: string;
  categorie?: { nom: string } | null;
  images: { imagePublicId: string }[];
}

interface Options {
  /** Cards shown at once. */
  perSlot?: number;
  /** How many different sets to prepare before the rotation starts over. */
  slots?: number;
  /** Injectable for tests; defaults to Math.random. */
  random?: () => number;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Sets of products for the homepage hero to rotate through, so the cards show the whole shop and not
 * just one corner of it.
 *
 *  - Each set takes its cards from different categories (consecutive categories in a shuffled order).
 *  - Walking through the sets visits every category, and takes the next product of a category each
 *    time it comes round, so the same item does not keep coming back.
 *  - Products without a photo are skipped, since a card without a picture is not worth showing.
 */
export function buildHeroSlots<T extends HeroProduct>(products: T[], options: Options = {}): T[][] {
  const { perSlot = 4, slots = 12, random = Math.random } = options;

  const byCategory = new Map<string, T[]>();
  for (const p of products) {
    if (!p.images?.[0]?.imagePublicId) continue;
    const key = p.categorie?.nom ?? "Other";
    byCategory.set(key, [...(byCategory.get(key) ?? []), p]);
  }
  if (byCategory.size === 0) return [];

  const categories = shuffle([...byCategory.keys()], random);
  for (const key of categories) byCategory.set(key, shuffle(byCategory.get(key)!, random));

  const next = new Map(categories.map((c) => [c, 0]));
  const result: T[][] = [];
  for (let s = 0; s < slots; s++) {
    const seen = new Set<string>();
    const slot: T[] = [];
    for (let i = 0; i < perSlot; i++) {
      const category = categories[(s * perSlot + i) % categories.length];
      const list = byCategory.get(category)!;
      const index = next.get(category)!;
      next.set(category, index + 1);
      const product = list[index % list.length];
      if (!seen.has(product.id)) {
        seen.add(product.id);
        slot.push(product);
      }
    }
    result.push(slot);
  }
  return result;
}
