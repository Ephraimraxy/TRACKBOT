import { PrismaClient, UserRole } from "@prisma/client";

export const db = new PrismaClient();

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Empty every table the tests touch. */
export async function resetDb() {
  await db.$executeRawUnsafe(
    `TRUNCATE "user", "produit", "adresse", "categorie", "faq" RESTART IDENTITY CASCADE`
  );
}

export async function makeUser(role: UserRole = UserRole.CLIENT) {
  const id = `u${uid()}`;
  const user = await db.user.create({
    data: {
      id,
      email: `${id}@test.local`,
      password: "not-a-real-hash",
      nom: "Test",
      prenom: role,
      role,
      emailVerifie: true,
    },
  });
  if (role === UserRole.CLIENT) await db.client.create({ data: { id } });
  if (role === UserRole.ADMIN) await db.admin.create({ data: { userId: id } });
  return user;
}

export async function makeProduct(opts: { stock?: number; price?: number } = {}) {
  return db.produit.create({
    data: {
      nom: `Produit ${uid()}`,
      prix: opts.price ?? 1500,
      qteStock: opts.stock ?? 10,
    },
  });
}

export const address = {
  rue: "1 Rue Test",
  ville: "Keffi",
  wilaya: "Nasarawa",
  codePostal: "961101",
};

export const payment = {
  cardNumber: "4242424242424242",
  cvc: "123",
  expirationDate: "12/30",
  legalName: "Test Customer",
};
