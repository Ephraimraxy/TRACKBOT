/** Highest price the catalogue price filter covers, in naira. Items such as TVs and laptops cost far more than clothes. */
export const PRICE_MAX = 1_000_000;

/**
 * Categories whose products have a gender (Men / Women / Children / Unisex). Everything else, such as
 * electronics or groceries, has none, so combining one of those with a gender would show nothing.
 */
export const GENDERED_CATEGORIES = [
  "Tops", "Bottoms", "Dresses & Sets", "Jackets & Coats", "Footwear", "Accessories", "Other",
  "Baby & Kids", "Toys & Games",
];
