import type { NotificationType } from "@prisma/client";

/** What a notification's type is called on screen. The stored values are French identifiers and are not shown as they are. */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  DEFAULT: "General",
  COMMANDE: "Order",
  LIVRAISON: "Delivery",
  PAIEMENT: "Payment",
  SIGNALEMENT: "Report",
  EVALUATION: "Review",
  MESSAGE: "Message",
  SECURITE: "Security",
};

export const notificationTypeLabel = (type: NotificationType): string => NOTIFICATION_TYPE_LABELS[type] ?? type;
