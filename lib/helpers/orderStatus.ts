import { CommandeStatut } from "@prisma/client";

import { STATUS_LABELS_EN } from "@/lib/orders/workflow";

// Fonction pour déterminer la couleur du statut
export const getStatusColor = (statut: string): string => {
  switch (statut) {
    case CommandeStatut.EN_COURS:
      return "text-amber-600 bg-amber-100";
    case CommandeStatut.EN_PREPARATION:
      return "text-purple-600 bg-purple-100";
    case CommandeStatut.EXPEDIEE:
      return "text-blue-600 bg-blue-100";
    case CommandeStatut.EN_LIVRAISON:
      return "text-cyan-600 bg-cyan-100";
    case CommandeStatut.LIVREE:
      return "text-teal-700 bg-teal-100";
    case CommandeStatut.RECUE:
      return "text-green-700 bg-green-100";
    case CommandeStatut.ANNULEE:
      return "text-red-600 bg-red-100";
    default:
      return "text-gray-600 bg-gray-100";
  }
};

// English label of an order status (see lib/orders/workflow.ts for the full set)
export const getStatusLabel = (statut: string): string =>
  STATUS_LABELS_EN[statut as CommandeStatut] ?? statut;
