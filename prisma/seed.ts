/**
 * Default seed: REFERENCE DATA ONLY (categories, genders, colours, sizes). Safe to run on any
 * database, including production, and idempotent. It creates no accounts, no products and
 * no orders. Create the first administrator with `npm run seed:admin`.
 * For local development sample data see `prisma/seed-demo.ts` (`npm run seed:demo`).
 */
import insertCategories from "@/lib/seed/insertCategories";
import insertColors from "@/lib/seed/insertColors";
import insertGenders from "@/lib/seed/insertGenders";
import insertSizes from "@/lib/seed/insertSizes";
import { prisma } from "@/lib/utils/prisma";

async function main() {
  await insertCategories();
  await insertGenders();
  await insertColors();
  await insertSizes();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
