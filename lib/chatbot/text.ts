/** Small text helpers shared by the rule-based bot and the FAQ search (French and English). */

export const STOPWORDS = new Set(
  (
    "le la les un une des du de d l et ou à a au aux en pour avec sans sur dans par je tu il elle nous vous ils " +
    "est sont ai as avez avons ce cet cette ces mon ma mes ton ta tes son sa ses quel quelle quels quelles prix " +
    "combien coute coûte cherche acheter montre moi svp stp bonjour salut merci stock disponible vendez " +
    "the a an of to for with in on at is are do you have your my me i we it this that what which how much " +
    "price cost looking show buy please hello hi hey available any some can"
  ).split(/\s+/)
);

/** Lowercase, remove accents ("délais" -> "delais"). */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Crude plural stripping so "delais"/"delai" and "retours"/"retour" match. */
function stem(word: string): string {
  return word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
}

/** Meaningful lower-case words of `text`, accents removed and plurals stripped. */
export function significantTokens(text: string, minLength = 2): string[] {
  const seen = new Set<string>();
  for (const raw of fold(text).split(/[^a-z0-9]+/)) {
    if (raw.length < minLength || STOPWORDS.has(raw)) continue;
    seen.add(stem(raw));
  }
  return [...seen];
}
