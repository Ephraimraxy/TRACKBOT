import {
  ALLOWED_IMAGE_FORMATS,
  MAX_ID_LENGTH,
  MAX_UPLOAD_SIZE_MB,
} from "@/lib/constants/settings";
import { z } from "zod";

// Définition du schéma de validation Zod pour un produit
export const productSchema = z.object({
  nom: z.string().min(1, "The name is required").max(100, "The name is too long"),
  objet: z.string().max(255, "The subject is too long").optional(),
  description: z
    .string()
    .max(1000, "The description is too long")
    .optional(),
  prix: z
    .number({ invalid_type_error: "The price must be a number" })
    .min(0, "The price cannot be negative"),
  qteStock: z
    .number({ invalid_type_error: "The quantity must be a whole number" })
    .int()
    .min(0, "The quantity cannot be negative"),
  categorieId: z
    .string()
    .max(MAX_ID_LENGTH, "The category ID is invalid")
    .optional(),
  genreId: z
    .string()
    .max(MAX_ID_LENGTH, "The gender ID is invalid")
    .optional(),
  couleurs: z
    .array(z.string().max(MAX_ID_LENGTH, "The colour ID is invalid"))
    .optional(),
  tailles: z
    .array(z.string().max(MAX_ID_LENGTH, "The size ID is invalid"))
    .optional(),
  images: z
    .array(
      z.instanceof(File).refine((file) => file.type.startsWith("image/"), {
        message: "The file must be an image",
      })
    )
    .refine(
      (files) =>
        files.every((file) => file.size <= MAX_UPLOAD_SIZE_MB * 1024 * 1024),
      {
        message: `Image size cannot exceed ${MAX_UPLOAD_SIZE_MB} MB`,
      }
    )
    .refine(
      (files) =>
        files.every((file) => ALLOWED_IMAGE_FORMATS.includes(file.type)),
      {
        message: `Allowed formats: ${ALLOWED_IMAGE_FORMATS.join(
          ", "
        )}`,
      }
    )
    .refine((files) => files.length >= 1 && files.length <= 4, {
      message: "You must upload between 1 and 4 images",
    }),
});

// Définition du schéma de validation Zod pour la mise à jour d'un produit
export const updateProductSchema = z
  .object({
    nom: z
      .string()
      .min(1, "The name is required")
      .max(100, "The name is too long")
      .optional(),
    objet: z.string().max(255, "The subject is too long").optional(),
    description: z
      .string()
      .max(1000, "The description is too long")
      .optional(),
    prix: z
      .number({ invalid_type_error: "The price must be a number" })
      .min(0, "The price cannot be negative")
      .optional(),
    qteStock: z
      .number({ invalid_type_error: "The quantity must be a whole number" })
      .int()
      .min(0, "The quantity cannot be negative")
      .optional(),
    categorieId: z
      .string()
      .max(MAX_ID_LENGTH, "The category ID is invalid")
      .optional(),
    genreId: z
      .string()
      .max(MAX_ID_LENGTH, "The gender ID is invalid")
      .optional(),
    couleurs: z
      .array(z.string().max(MAX_ID_LENGTH, "The colour ID is invalid"))
      .optional(),
    tailles: z
      .array(z.string().max(MAX_ID_LENGTH, "The size ID is invalid"))
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be filled in.",
  });
