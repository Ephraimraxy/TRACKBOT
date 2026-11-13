/**
 * Creates the opening shop catalogue (42 products with photos) on the server.
 *
 *   npm run seed:catalog        run by hand; fails loudly
 *   --if-requested              used by `npm start`: does nothing unless SEED_CATALOG=true, and never
 *                               stops the server from starting
 *
 * Needs the database and the image storage (R2) variables, so it runs where the app runs. Photos are
 * fetched from Unsplash and stored in your own bucket. See lib/seed/catalogData.ts.
 */
import { PrismaClient } from "@prisma/client";

import insertCategories from "@/lib/seed/insertCategories";
import insertColors from "@/lib/seed/insertColors";
import insertGenders from "@/lib/seed/insertGenders";
import insertSizes from "@/lib/seed/insertSizes";
import { fetchUnsplashImage, seedCatalog } from "@/lib/seed/seedCatalog";
import { requireStorage } from "@/lib/helpers/storage";

const optional = process.argv.includes("--if-requested");

async function main() {
  if (optional && process.env.SEED_CATALOG !== "true") {
    console.log("Catalogue seed skipped (SEED_CATALOG is not true).");
    return;
  }

  await insertCategories();
  await insertGenders();
  await insertColors();
  await insertSizes();

  const db = new PrismaClient();
  try {
    const { created, skipped, failed } = await seedCatalog({ db, storage: requireStorage(), fetchImage: fetchUnsplashImage });
    console.log(`Catalogue: ${created.length} created, ${skipped.length} already there, ${failed.length} failed.`);
    for (const f of failed) console.error(`  - ${f.nom}: ${f.reason}`);
    if (failed.length && !optional) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Catalogue seed: ${e.message}`);
  // Started by `npm start`: a failure here must not take the site down.
  process.exit(optional ? 0 : 1);
});
