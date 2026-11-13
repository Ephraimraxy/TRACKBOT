import {
  ALLOWED_IMAGE_FORMATS,
  MAX_UPLOAD_SIZE_MB,
} from "@/lib/constants/settings";
import { z } from "zod";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/constants/password";

export const updateUserSchema = z
  .object({
    email: z.string().email("Email invalide").optional(),
    currentPassword: z.string().optional(),
    newPassword: z
      .string()
      .min(PASSWORD_MIN, `The password must contain at least ${PASSWORD_MIN} characters.`)
      .max(PASSWORD_MAX, `The password must contain at most ${PASSWORD_MAX} characters.`)
      .optional(),
    nom: z.string().min(1, "The name is required").optional(),
    prenom: z.string().min(1, "The first name is required").optional(),
    tel: z
      .string()
      .regex(/^[0-9+\-().\s]{7,20}$/, "Invalid phone number")
      .optional(),
  })
  .strict()
  .refine(
    (data) =>
      (!data.newPassword && !data.currentPassword) ||
      (data.newPassword && data.currentPassword),
    {
      message:
        "The 'current password' and 'new password' fields must be provided together.",
      path: ["newPassword"],
    }
  );

// Schema for updating user address
export const updateAddressSchema = z.object({
  rue: z.string().min(1, "The street is required."),
  ville: z.string().min(1, "The city is required."),
  wilaya: z.string().min(1, "The state is required."),
  codePostal: z.string().min(4, "Invalid postcode."),
});

// Schema for updating user avatar
export const updateUserAvatarSchema = z.object({
  file: z
    .instanceof(File)
    .refine((file) => ALLOWED_IMAGE_FORMATS.includes(file.type), {
      message: "Unsupported image format.",
    })
    .refine((file) => file.size <= MAX_UPLOAD_SIZE_MB * 1024 * 1024, {
      message: `The image must not exceed ${MAX_UPLOAD_SIZE_MB} MB.`,
    }),
});

// Schema for becoming a vendor
export const becomeVendorSchema = z.object({
  nomBoutique: z.string().min(1, "Shop name is required"),
  description: z.string().optional(),
  nomBanque: z.string().min(1, "Bank name is required"),
  rib: z.string().min(1, "Account number is required"),
});

// Partial update schema for PATCH
export const updateVendorSchema = z
  .object({
    nomBoutique: z.string().max(100).optional(),
    description: z.string().max(1000).optional(),
    nomBanque: z.string().max(50).optional(),
    rib: z.string().max(50).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be filled in.",
  });
