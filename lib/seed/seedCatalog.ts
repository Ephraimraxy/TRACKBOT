import type { PrismaClient } from "@prisma/client";

import { CATALOG, IMAGE_URL, type CatalogProduct } from "@/lib/seed/catalogData";

export interface CatalogDeps {
  db: PrismaClient;
  /** Stores one image and returns its key (see createStorage). */
  storage: { uploadImage(file: File, folder: string): Promise<{ key: string }>; deleteImage(key: string): Promise<void> };
  /** Fetches the bytes of one photo. Injected so tests never touch the network. */
  fetchImage: (photo: string) => Promise<Uint8Array>;
}

export interface CatalogResult {
  created: string[];
  skipped: string[];
  failed: { nom: string; reason: string }[];
}

export async function fetchUnsplashImage(photo: string): Promise<Uint8Array> {
  const res = await fetch(IMAGE_URL(photo));
  if (!res.ok) throw new Error(`photo ${photo}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Creates the opening catalogue. Safe to run again: a product whose name already exists is left
 * alone (so edits and deletions made by the owner are never overwritten by a re-run, and nothing
 * is duplicated). A product that fails (photo not reachable, image rejected) is reported and the
 * others continue; its stored image, if any, is removed so no orphan is left behind.
 */
export async function seedCatalog(deps: CatalogDeps, products: CatalogProduct[] = CATALOG): Promise<CatalogResult> {
  const { db, storage, fetchImage } = deps;
  const result: CatalogResult = { created: [], skipped: [], failed: [] };

  const [categories, genders, colours, sizes] = await Promise.all([
    db.categorie.findMany(),
    db.genre.findMany(),
    db.couleur.findMany(),
    db.taille.findMany(),
  ]);
  const byName = <T extends { id: string; nom: string }>(rows: T[]) => new Map(rows.map((r) => [r.nom, r.id]));
  const cat = byName(categories), gen = byName(genders), col = byName(colours), siz = byName(sizes);

  const need = (map: Map<string, string>, name: string, what: string) => {
    const id = map.get(name);
    if (!id) throw new Error(`${what} "${name}" does not exist`);
    return id;
  };

  for (const p of products) {
    if (await db.produit.findFirst({ where: { nom: p.nom }, select: { id: true } })) {
      result.skipped.push(p.nom);
      continue;
    }

    let key: string | null = null;
    try {
      const categorieId = need(cat, p.categorie, "Category");
      const genreId = p.genre ? need(gen, p.genre, "Gender") : undefined; // not clothing: no gender
      const couleurIds = p.couleurs.map((c) => need(col, c, "Colour"));
      const tailleIds = p.tailles.map((s) => need(siz, s, "Size"));

      const bytes = await fetchImage(p.photo);
      ({ key } = await storage.uploadImage(new File([bytes as BlobPart], `${p.photo}.jpg`, { type: "image/jpeg" }), "products"));

      await db.produit.create({
        data: {
          nom: p.nom,
          objet: p.objet,
          description: p.description,
          prix: p.prix,
          qteStock: p.stock,
          categorieId,
          genreId,
          couleurs: { connect: couleurIds.map((id) => ({ id })) },
          tailles: { connect: tailleIds.map((id) => ({ id })) },
          images: { create: [{ imagePublicId: key }] },
          produitBoutique: { create: {} },
        },
      });
      result.created.push(p.nom);
    } catch (error) {
      if (key) await storage.deleteImage(key);
      result.failed.push({ nom: p.nom, reason: (error as Error).message });
    }
  }
  return result;
}
