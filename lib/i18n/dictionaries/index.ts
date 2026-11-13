import type { Locale } from "@/lib/i18n/config";

import fr from "@/lib/i18n/dictionaries/fr";
import es from "@/lib/i18n/dictionaries/es";
import ha from "@/lib/i18n/dictionaries/ha";
import ig from "@/lib/i18n/dictionaries/ig";
import yo from "@/lib/i18n/dictionaries/yo";

/** English sentence -> translation, per language. English itself needs no dictionary. */
export const dictionaries: Partial<Record<Locale, Record<string, string>>> = { fr, es, ha, ig, yo };
