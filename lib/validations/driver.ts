import { z } from "zod";

import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/constants/password";

/** What the shop owner types to register a delivery person. */
export const createDriverSchema = z.object({
  prenom: z.string().trim().min(2, "First name must contain at least 2 characters.").max(50),
  nom: z.string().trim().min(2, "Last name must contain at least 2 characters.").max(50),
  email: z
    .string()
    .trim()
    .email("Please enter a valid email address.")
    .transform((email) => email.toLowerCase()),
  tel: z
    .string()
    .trim()
    .regex(/^[0-9+\s-]{7,20}$/, "Enter a valid phone number.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  password: z
    .string()
    .min(PASSWORD_MIN, `The password must contain at least ${PASSWORD_MIN} characters.`)
    .max(PASSWORD_MAX, `The password must contain at most ${PASSWORD_MAX} characters.`),
});

export type CreateDriverInput = z.infer<typeof createDriverSchema>;
