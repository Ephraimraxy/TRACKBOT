import { CommandeStatut as S, UserRole as R } from "@prisma/client";

import { changeOrderStatus, createOrder } from "@/lib/services/orderService";
import { address, db, makeProduct, makeUser } from "./helpers";

const STEPS = [S.EN_PREPARATION, S.EXPEDIEE, S.EN_LIVRAISON, S.LIVREE];

/** Create an order for `client` and move it (as admin) up to `status`. */
export async function orderAt(client: { id: string }, admin: { id: string }, status: S = S.EN_COURS) {
  const product = await makeProduct({ stock: 50 });
  const { order } = await createOrder(db, {
    userId: client.id,
    addresse: address,
    produits: [{ produitId: product.id, quantite: 1 }],
  });
  const asAdmin = { id: admin.id, role: R.ADMIN };
  if (status === S.ANNULEE) {
    await changeOrderStatus(db, { orderId: order.id, to: S.ANNULEE, actor: asAdmin });
    return order.id;
  }
  for (const step of STEPS) {
    if (status === S.EN_COURS) break;
    await changeOrderStatus(db, { orderId: order.id, to: step, actor: asAdmin });
    if (step === status) break;
  }
  return order.id;
}

export async function world() {
  const client = await makeUser();
  const admin = await makeUser(R.ADMIN);
  const driver = await makeUser(R.LIVREUR);
  const otherDriver = await makeUser(R.LIVREUR);
  return { client, admin, driver, otherDriver };
}

export const adminActor = (u: { id: string }) => ({ id: u.id, role: R.ADMIN });
export const driverActor = (u: { id: string }) => ({ id: u.id, role: R.LIVREUR });
export const clientActor = (u: { id: string }) => ({ id: u.id, role: R.CLIENT });
