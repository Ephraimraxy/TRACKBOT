"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { translate, type Vars } from "@/lib/i18n/translate";

interface I18nContextValue {
  locale: Locale;
  t: (text: string, vars?: Vars) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  t: (text, vars) => translate(DEFAULT_LOCALE, text, vars),
  setLocale: () => {},
});

/** Holds the current language for client components. The server reads the same cookie, so both agree. */
export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      if (!isLocale(next)) return;
      // One year; not a secret, so it does not need to be HttpOnly.
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      setLocaleState(next);
      router.refresh(); // re-render server components in the new language
    },
    [router]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t: (text, vars) => translate(locale, text, vars) }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
