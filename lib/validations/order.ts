import { z } from "zod";

// Delivery address schema
const deliveryAddressSchema = z.object({
  rue: z.string().min(1, "Street is required"),
  ville: z.string().min(1, "City is required"),
  wilaya: z.string().min(1, "State is required"),
  codePostal: z.string().min(1, "Postcode is required"),
  // Optional landmark or directions for the delivery person.
  repere: z.string().trim().max(200, "Directions are too long (200 characters at most)").optional(),
  // Optional pin on the map: where exactly to deliver.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

// Order line schema
const orderLineSchema = z.object({
  produitId: z.string().min(1, "Product ID is required"),
  quantite: z
    .number()
    .int()
    .positive("Quantity must be a positive integer")
    .max(99, "Quantity cannot exceed 99 per line"),
  tailleId: z.string().optional(),
  couleurId: z.string().optional(),
});

// Create order schema
export const createOrderSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  addresse: deliveryAddressSchema,
  produits: z.array(orderLineSchema).min(1, "At least one product is required"),
});

// Create order schema
export const prepareOrderSchema = z.object({
  produits: z.array(orderLineSchema).min(1, "At least one product is required"),
});

