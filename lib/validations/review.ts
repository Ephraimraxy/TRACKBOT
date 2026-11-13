import { z } from "zod";

export const reviewSchema = z.object({
  productId: z.string().min(1, { message: "The product is required" }),
  note: z.number().min(0.5).max(5).multipleOf(0.5),
  text: z.string().min(1).max(500).optional(),
});

export const updateReviewSchema = z.object({
  note: z.number().min(0.5).max(5).multipleOf(0.5),
  text: z.string().min(1).max(500).optional(),
});

export const reviewResponseSchema = z.object({
  text: z
    .string({
      required_error: "The text is required.",
    })
    .min(1, "The text cannot be empty.")
    .max(500, "The text cannot exceed 500 characters."),
});
