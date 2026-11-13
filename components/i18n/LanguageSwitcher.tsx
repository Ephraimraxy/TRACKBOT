"use client";

import { Globe } from "lucide-react";

import { useI18n } from "@/components/i18n/LocaleProvider";
import { isLocale, LOCALES } from "@/lib/i18n/config";

/**
 * Language picker. The choice is saved in a cookie, so it is remembered on this device
 * and applies to server-rendered and client-rendered text alike.
 */
export default function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className={`inline-flex items-center gap-1.5 text-sm ${className}`}>
      <Globe size={16} aria-hidden="true" />
      <span className="sr-only">{t("Language")}</span>
      <select
        value={locale}
        onChange={(e) => isLocale(e.target.value) && setLocale(e.target.value)}
        className="cursor-pointer rounded-md border border-black/15 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        aria-label={t("Language")}
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
