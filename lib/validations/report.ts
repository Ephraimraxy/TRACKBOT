import { z } from "zod";

export const reportSchema = z.object({
  objet: z
    .string()
    .max(255, { message: "The subject cannot exceed 255 characters" }),
  text: z
    .string()
    .max(1000, { message: "The text cannot exceed 1000 characters" })
    .optional(),
  produitId: z
    .string({ required_error: "The product ID is required" })
    .min(1, { message: "The product ID cannot be empty" }),
});
