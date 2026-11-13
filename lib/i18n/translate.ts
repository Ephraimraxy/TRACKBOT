import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";

export type Vars = Record<string, string | number>;

/**
 * Translate an English sentence into `locale`.
 *  - The English text itself is the key. English (and any sentence missing from a
 *    dictionary) is returned unchanged, so a gap never breaks a page.
 *  - `{name}` placeholders are filled from `vars`.
 */
export function translate(locale: Locale, text: string, vars?: Vars): string {
  const base = locale === DEFAULT_LOCALE ? text : dictionaries[locale]?.[text] ?? text;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}
