import { CommandeStatut, UserRole } from "@prisma/client";

/**
 * Single source of truth for the order lifecycle.
 *
 *  EN_COURS (Order placed) -> EXPEDIEE (Ready for delivery) -> EN_LIVRAISON (Out for delivery) -> LIVREE (Delivered)
 *
 *  The owner's only job is to assign a delivery person: assigning moves the order to "Ready for delivery" by
 *  itself (see assignDriver). EN_PREPARATION ("Preparing") stays available as an optional step for shops that
 *  want to show that packing has started. An order can be cancelled (ANNULEE) until it is out for delivery.
 */
export const STATUS_TRANSITIONS: Record<CommandeStatut, CommandeStatut[]> = {
  [CommandeStatut.EN_COURS]: [
    CommandeStatut.EN_PREPARATION,
    CommandeStatut.EXPEDIEE,
    CommandeStatut.ANNULEE,
  ],
  [CommandeStatut.EN_PREPARATION]: [
    CommandeStatut.EXPEDIEE,
    CommandeStatut.ANNULEE,
  ],
  [CommandeStatut.EXPEDIEE]: [
    CommandeStatut.EN_LIVRAISON,
    CommandeStatut.ANNULEE,
  ],
  [CommandeStatut.EN_LIVRAISON]: [CommandeStatut.LIVREE],
  [CommandeStatut.LIVREE]: [],
  [CommandeStatut.ANNULEE]: [],
};

export const STATUS_LABELS_FR: Record<CommandeStatut, string> = {
  [CommandeStatut.EN_COURS]: "Commande passée",
  [CommandeStatut.EN_PREPARATION]: "En préparation",
  [CommandeStatut.EXPEDIEE]: "Prête pour la livraison",
  [CommandeStatut.EN_LIVRAISON]: "En cours de livraison",
  [CommandeStatut.LIVREE]: "Livrée",
  [CommandeStatut.ANNULEE]: "Annulée",
};

export const STATUS_LABELS_EN: Record<CommandeStatut, string> = {
  [CommandeStatut.EN_COURS]: "Order placed",
  [CommandeStatut.EN_PREPARATION]: "Preparing",
  [CommandeStatut.EXPEDIEE]: "Ready for delivery",
  [CommandeStatut.EN_LIVRAISON]: "Out for delivery",
  [CommandeStatut.LIVREE]: "Delivered",
  [CommandeStatut.ANNULEE]: "Cancelled",
};

export function isTerminalStatus(status: CommandeStatut): boolean {
  return STATUS_TRANSITIONS[status].length === 0;
}

/** Is `from -> to` a legal step in the lifecycle (regardless of who asks)? */
export function canTransition(from: CommandeStatut, to: CommandeStatut): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Which legal transitions a role may perform.
 *  - ADMIN (business owner): every legal transition.
 *  - LIVREUR (delivery person): only the two delivery steps. Whether the
 *    order is assigned to *this* driver is checked separately by the caller.
 *  - everyone else: none.
 */
const DRIVER_STEPS: Array<[CommandeStatut, CommandeStatut]> = [
  [CommandeStatut.EXPEDIEE, CommandeStatut.EN_LIVRAISON],
  [CommandeStatut.EN_LIVRAISON, CommandeStatut.LIVREE],
];

export function roleCanTransition(
  role: UserRole,
  from: CommandeStatut,
  to: CommandeStatut
): boolean {
  if (!canTransition(from, to)) return false;
  if (role === UserRole.ADMIN) return true;
  if (role === UserRole.LIVREUR) {
    return DRIVER_STEPS.some(([f, t]) => f === from && t === to);
  }
  return false;
}
