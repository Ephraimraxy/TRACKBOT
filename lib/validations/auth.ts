import { z } from "zod";

import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/constants/password";

export const registerSchema = z.object({
  email: z
    .string()
    .email("Please enter a valid email address.")
    .transform((email) => email.toLowerCase()), // email en minuscules
  password: z
    .string()
    .min(PASSWORD_MIN, `The password must contain at least ${PASSWORD_MIN} characters.`)
    .max(PASSWORD_MAX, `The password must contain at most ${PASSWORD_MAX} characters.`),
  nom: z
    .string()
    .min(2, "The last name must contain at least 2 characters.")
    .transform(
      (nom) => nom.charAt(0).toUpperCase() + nom.slice(1).toLowerCase()
    ), // Capitaliser le nom
  prenom: z
    .string()
    .min(2, "The first name must contain at least 2 characters.")
    .transform(
      (prenom) => prenom.charAt(0).toUpperCase() + prenom.slice(1).toLowerCase()
    ), // Capitaliser le prénom
});

export const loginSchema = z.object({
  email: z
    .string()
    .email("Please enter a valid email address.")
    .transform((email) => email.toLowerCase()),
  password: z.string().min(1, "The password is required."),
});

export const resetPasswordSchema = z.object({
  email: z
    .string()
    .email("Please enter a valid email address.")
    .transform((email) => email.toLowerCase()),
  newPassword: z
    .string()
    .min(PASSWORD_MIN, `The password must contain at least ${PASSWORD_MIN} characters.`)
    .max(PASSWORD_MAX, `The password must contain at most ${PASSWORD_MAX} characters.`),
  code: z
    .string()
    .regex(/^\d{6}$/, "The code must contain exactly 6 digits."),
});
