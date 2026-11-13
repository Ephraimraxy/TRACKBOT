/**
 * LOCAL DEVELOPMENT ONLY. Creates a few demo accounts and sample products so the system can be
 * tried and the live test scripts (tests/live/*.mjs) can run. Refuses to run in production.
 * Accounts use the password in DEFAULT_PASSWORD. Products have no photos on purpose: upload
 * real ones from the admin screen.
 *
 *   npm run seed:demo
 */
import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

import insertCategories from "@/lib/seed/insertCategories";
import insertColors from "@/lib/seed/insertColors";
import insertGenders from "@/lib/seed/insertGenders";
import insertSizes from "@/lib/seed/insertSizes";

const prisma = new PrismaClient();

const ACCOUNTS = [
  { email: "admin@email.com", role: UserRole.ADMIN, prenom: "Demo", nom: "Owner", tel: null },
  { email: "client@email.com", role: UserRole.CLIENT, prenom: "Demo", nom: "Customer", tel: "08000000001" },
  { email: "client1@email.com", role: UserRole.CLIENT, prenom: "Second", nom: "Customer", tel: "08000000002" },
  { email: "livreur1@email.com", role: UserRole.LIVREUR, prenom: "Demo", nom: "Driver One", tel: "08000000003" },
  { email: "livreur2@email.com", role: UserRole.LIVREUR, prenom: "Demo", nom: "Driver Two", tel: "08000000004" },
];

const PRODUCTS = [
  { nom: "Ankara Print Shirt", prix: 12500, stock: 30, categorie: "Tops", genre: "Men", objet: "Short-sleeve shirt in a bold Ankara print." },
  { nom: "Classic White Sneakers", prix: 28000, stock: 20, categorie: "Footwear", genre: "Unisex", objet: "Everyday leather-look sneakers." },
  { nom: "Slim-Fit Jeans", prix: 18500, stock: 25, categorie: "Bottoms", genre: "Men", objet: "Stretch denim, slim fit." },
  { nom: "Cotton Polo T-Shirt", prix: 9000, stock: 40, categorie: "Tops", genre: "Men", objet: "Breathable cotton polo." },
  { nom: "Leather Belt", prix: 6500, stock: 50, categorie: "Accessories", genre: "Unisex", objet: "Genuine leather belt." },
  { nom: "Canvas Tote Bag", prix: 7500, stock: 35, categorie: "Accessories", genre: "Women", objet: "Roomy canvas tote for daily use." },
  { nom: "Summer Dress", prix: 22000, stock: 15, categorie: "Dresses & Sets", genre: "Women", objet: "Light cotton dress for warm weather." },
  { nom: "Zip Hoodie", prix: 16000, stock: 18, categorie: "Jackets & Coats", genre: "Unisex", objet: "Soft fleece hoodie with front zip." },
];

async function main() {
  // Demo accounts share one password, so this must never reach a real (hosted) database.
  const hosted = process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT || /railway|rlwy\.net/i.test(process.env.DATABASE_URL ?? "");
  if (hosted) throw new Error("seed:demo is for local development only and will not run against a hosted database.");
  const password = process.env.DEFAULT_PASSWORD;
  if (!password) throw new Error("Set DEFAULT_PASSWORD in .env first.");

  await insertCategories();
  await insertGenders();
  await insertColors();
  await insertSizes();

  const hash = await bcrypt.hash(password, 10);
  for (const a of ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { email: a.email },
      update: { role: a.role, password: hash },
      create: { ...a, password: hash, emailVerifie: true },
    });
    if (a.role === UserRole.CLIENT) await prisma.client.upsert({ where: { id: user.id }, update: {}, create: { id: user.id } });
    if (a.role === UserRole.ADMIN) await prisma.admin.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
  }

  for (const p of PRODUCTS) {
    if (await prisma.produit.findFirst({ where: { nom: p.nom }, select: { id: true } })) continue;
    const categorie = await prisma.categorie.findUnique({ where: { nom: p.categorie } });
    const genre = await prisma.genre.findUnique({ where: { nom: p.genre } });
    await prisma.produit.create({
      data: {
        nom: p.nom,
        objet: p.objet,
        description: p.objet,
        prix: p.prix,
        qteStock: p.stock,
        categorieId: categorie?.id,
        genreId: genre?.id,
        produitBoutique: { create: { fournisseur: null } },
      },
    });
  }
  console.log(`Demo data ready: ${ACCOUNTS.length} accounts, ${PRODUCTS.length} products (no photos).`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
