import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Prisma } from "@prisma/client";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function compareArrays(a: unknown[], b: unknown[]) {
  return a.toString() === b.toString();
}

export function isMySQL(): boolean {
  return process.env.DATABASE_URL?.includes("mysql") ?? false;
}

export function containsFilter(value: string) {
  return isMySQL()
    ? { contains: value }
    : { contains: value, mode: Prisma.QueryMode.insensitive };
}

export function extractDateString(dateInput: Date | string): string {
  const date = new Date(dateInput);
  return date.toLocaleDateString("en-NG").replace(/\//g, "-");
}

/**
 * Public URL of a stored image. `imagePublicId` is the object key in the R2 bucket.
 * Falls back to the placeholder when the bucket URL is not configured.
 */
export const getImageUrlFromPublicId = (imagePublicId: string) => {
  if (/^https?:\/\//.test(imagePublicId)) return imagePublicId;
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/$/, "");
  if (!base) return "/images/no-image.png";
  return `${base}/${imagePublicId}`;
};
