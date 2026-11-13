import { cookies } from "next/headers";

import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { translate, type Vars } from "@/lib/i18n/translate";

/** The visitor's language (from the cookie set by the language switcher), English by default. */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** `t()` for server components: `const t = await getT(); t("Add to cart")`. */
export async function getT() {
  const locale = await getLocale();
  return (text: string, vars?: Vars) => translate(locale, text, vars);
}
