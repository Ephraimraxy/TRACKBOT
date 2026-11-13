/**
 * Languages offered by the language switcher. English is the default and the source language:
 * every user-visible English sentence in the code is also its own translation key, so a
 * sentence with no translation in a given language simply shows in English.
 */
export const LOCALES = [
  { code: "en", name: "English", english: "English" },
  { code: "fr", name: "Français", english: "French" },
  { code: "es", name: "Español", english: "Spanish" },
  { code: "ha", name: "Hausa", english: "Hausa" },
  { code: "ig", name: "Igbo", english: "Igbo" },
  { code: "yo", name: "Yorùbá", english: "Yoruba" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "trackbot-lang";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.some((l) => l.code === value);
}
