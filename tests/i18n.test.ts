import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, LOCALES, isLocale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/translate";
import fr from "@/lib/i18n/dictionaries/fr";
import es from "@/lib/i18n/dictionaries/es";
import ha from "@/lib/i18n/dictionaries/ha";
import ig from "@/lib/i18n/dictionaries/ig";
import yo from "@/lib/i18n/dictionaries/yo";

describe("i18n", () => {
  it("defaults to English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("recognises only supported locales", () => {
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("yo")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("returns the English text for English", () => {
    expect(translate("en", "Add to cart")).toBe("Add to cart");
  });

  it("translates a known sentence", () => {
    expect(translate("fr", "Add to cart")).toBe("Ajouter au panier");
    expect(translate("es", "Add to cart")).toBe("Añadir al carrito");
  });

  it("falls back to English when a sentence has no translation", () => {
    expect(translate("ha", "A sentence nobody translated")).toBe("A sentence nobody translated");
  });

  it("every non-English locale has a dictionary with no empty values", () => {
    const dictionaries = { fr, es, ha, ig, yo };
    for (const locale of LOCALES.map((l) => l.code).filter((c) => c !== "en")) {
      const dict = dictionaries[locale as keyof typeof dictionaries];
      expect(Object.keys(dict).length).toBeGreaterThan(50);
      for (const value of Object.values(dict)) expect(value.trim()).not.toBe("");
    }
  });
});
