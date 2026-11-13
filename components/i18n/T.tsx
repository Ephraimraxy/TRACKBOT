"use client";

import { useI18n } from "@/components/i18n/LocaleProvider";

/**
 * Translates a piece of text in the page: <T>Add to cart</T>.
 * Works inside both server and client components. Dynamic values stay outside, e.g.
 * <T>Showing</T> {from} <T>to</T> {to}.
 */
export function T({ children }: { children: string }) {
  const { t } = useI18n();
  return <>{t(children)}</>;
}
