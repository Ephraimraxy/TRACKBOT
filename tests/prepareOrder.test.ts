import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { UserRole as R } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { POST as prepare } from "@/app/api/orders/prepare/route";
import { db, makeProduct, makeUser, resetDb } from "./helpers";

const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const call = (produits: unknown[]) =>
  prepare(new NextRequest("http://localhost/api/orders/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produits }) }));

beforeEach(async () => {
  await resetDb();
  mockedAuth.mockReset();
  const client = await makeUser(R.CLIENT);
  mockedAuth.mockResolvedValue({ user: { id: client.id, role: R.CLIENT } });
});
afterAll(() => db.$disconnect());

describe("POST /api/orders/prepare", () => {
  it("prepares a product that has no colours and no sizes (the cart line carries neither)", async () => {
    const p = await makeProduct({ price: 100 });
    const res = await call([{ produitId: p.id, quantite: 1 }]);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.montant).toBe(100);
    expect(data.produits[0]).toMatchObject({ produitId: p.id, couleur: null, taille: null });
  });

  it("prepares a product with only a size (colour left out), the case that failed on the live site", async () => {
    const p = await makeProduct({ price: 100 });
    const size = await db.taille.create({ data: { nom: `S${Math.floor(Math.random() * 1e6)}`.slice(0, 10) } });
    await db.produit.update({ where: { id: p.id }, data: { tailles: { connect: { id: size.id } } } });
    const res = await call([{ produitId: p.id, quantite: 2, tailleId: size.id }]);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.montant).toBe(200);
    expect(data.produits[0].taille).toMatchObject({ id: size.id });
    expect(data.produits[0].couleur).toBeNull();
  });

  it("still returns the colour and size when the line has them", async () => {
    const p = await makeProduct();
    const size = await db.taille.create({ data: { nom: `M${Math.floor(Math.random() * 1e6)}`.slice(0, 10) } });
    const colour = await db.couleur.create({ data: { nom: `Red${Math.floor(Math.random() * 1e6)}`, code: "#ff0000" } });
    await db.produit.update({ where: { id: p.id }, data: { tailles: { connect: { id: size.id } }, couleurs: { connect: { id: colour.id } } } });
    const res = await call([{ produitId: p.id, quantite: 1, tailleId: size.id, couleurId: colour.id }]);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.produits[0]).toMatchObject({ couleur: { id: colour.id }, taille: { id: size.id } });
  });

  it("still refuses a product that does not exist, and a colour or size the product does not have", async () => {
    const p = await makeProduct();
    const colour = await db.couleur.create({ data: { nom: `Blue${Math.floor(Math.random() * 1e6)}`, code: "#0000ff" } });
    expect((await call([{ produitId: "nope", quantite: 1 }])).status).toBe(400);
    expect((await call([{ produitId: p.id, quantite: 1, couleurId: colour.id }])).status).toBe(400);
  });

  it("is still closed to anonymous visitors and to non-customers", async () => {
    const p = await makeProduct();
    mockedAuth.mockResolvedValue(null);
    expect((await call([{ produitId: p.id, quantite: 1 }])).status).toBe(401);
    const admin = await makeUser(R.ADMIN);
    mockedAuth.mockResolvedValue({ user: { id: admin.id, role: R.ADMIN } });
    expect((await call([{ produitId: p.id, quantite: 1 }])).status).toBe(403);
  });
});
