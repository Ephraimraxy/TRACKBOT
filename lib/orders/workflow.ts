import { CommandeStatut, UserRole } from "@prisma/client";

/**
 * Single source of truth for the order lifecycle.
 *
 *  EN_COURS (Pending) -> EN_PREPARATION (Processing) -> EXPEDIEE (Shipped)
 *      -> EN_LIVRAISON (Out for delivery) -> LIVREE (Delivered)
 *      -> LIVREE (Delivered: the delivery person says it arrived) -> RECUE (Received: the customer confirms)
 *  The delivery stays open after LIVREE until the customer confirms receipt. An order can be cancelled (ANNULEE)
 *  until it is out for delivery.
 */
export const STATUS_TRANSITIONS: Record<CommandeStatut, CommandeStatut[]> = {
  [CommandeStatut.EN_COURS]: [
    CommandeStatut.EN_PREPARATION,
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
  [CommandeStatut.LIVREE]: [CommandeStatut.RECUE],
  [CommandeStatut.RECUE]: [],
  [CommandeStatut.ANNULEE]: [],
};

export const STATUS_LABELS_FR: Record<CommandeStatut, string> = {
  [CommandeStatut.EN_COURS]: "En attente",
  [CommandeStatut.EN_PREPARATION]: "En préparation",
  [CommandeStatut.EXPEDIEE]: "Expédiée",
  [CommandeStatut.EN_LIVRAISON]: "En cours de livraison",
  [CommandeStatut.LIVREE]: "Livrée",
  [CommandeStatut.RECUE]: "Reçue",
  [CommandeStatut.ANNULEE]: "Annulée",
};

export const STATUS_LABELS_EN: Record<CommandeStatut, string> = {
  [CommandeStatut.EN_COURS]: "Pending",
  [CommandeStatut.EN_PREPARATION]: "Processing",
  [CommandeStatut.EXPEDIEE]: "Shipped",
  [CommandeStatut.EN_LIVRAISON]: "Out for delivery",
  [CommandeStatut.LIVREE]: "Delivered",
  [CommandeStatut.RECUE]: "Received",
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
 *  - CLIENT (customer): only "I received it" (Delivered -> Received). Whether the order is *theirs* is checked
 *    separately by the caller.
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
  if (role === UserRole.CLIENT) {
    return from === CommandeStatut.LIVREE && to === CommandeStatut.RECUE;
  }
  return false;
}
