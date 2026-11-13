import { z } from "zod";

/** The reminder intervals a customer can pick, in minutes. 0 means no reminders. */
export const REMINDER_CHOICES = [0, 2, 5, 10, 15, 30] as const;

export const deliveryUpdatesSchema = z
  .object({
    rappelLivraisonMinutes: z
      .number()
      .int()
      .refine((n): n is (typeof REMINDER_CHOICES)[number] => (REMINDER_CHOICES as readonly number[]).includes(n), {
        message: `Choose one of: ${REMINDER_CHOICES.join(", ")} minutes (0 turns reminders off).`,
      })
      .optional(),
    alerteProche: z.boolean().optional(),
  })
  .refine((v) => v.rappelLivraisonMinutes !== undefined || v.alerteProche !== undefined, {
    message: "Nothing to change.",
  });
