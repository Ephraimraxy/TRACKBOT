/**
 * Anti-hallucination check for money amounts.
 *
 * Every price the model writes must be a number that one of this turn's tool
 * results actually contained. A reply with an unknown amount is rejected and the
 * engine falls back to another provider or to the rule-based answer.
 *
 * Limits (stated honestly): this checks money amounts only. It does not prove
 * every sentence is true; statuses and stock come from tools because the
 * system prompt requires it and the engine insists a tool is used for
 * product/order questions.
 */

const CURRENCY = "(?:NGN|DA|DZD|USD|EUR|₦|\\$|€)";
const AMOUNT = "\\d{1,3}(?:[ \\u00a0.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
const MONEY_AFTER = new RegExp(`(${AMOUNT})\\s?${CURRENCY}`, "gi");
const MONEY_BEFORE = new RegExp(`${CURRENCY}\\s?(${AMOUNT})`, "gi");

/** "1 500", "1.500,00", "1,500.00", "1500.5" -> number */
export function parseAmount(text: string): number {
  const s = text.replace(/[\s ]/g, "");
  // "1.500" or "1,500,000": separators used as thousands grouping.
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  // "1.500,50" / "1,500.50": the last separator is the decimal point.
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalIsComma = lastComma > lastDot;
    return Number(decimalIsComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  }
  return Number(s.replace(",", "."));
}

/** Every number appearing anywhere in the tool outputs. */
export function numbersIn(texts: string[]): number[] {
  const out: number[] = [];
  for (const t of texts) for (const m of t.match(/-?\d+(?:\.\d+)?/g) ?? []) out.push(Number(m));
  return out;
}

/** Money amounts in `reply` that no tool result contained. */
export function findUngroundedAmounts(reply: string, toolOutputs: string[]): number[] {
  const known = numbersIn(toolOutputs);
  const stated: number[] = [];
  for (const re of [MONEY_AFTER, MONEY_BEFORE]) {
    re.lastIndex = 0;
    for (const m of reply.matchAll(re)) stated.push(parseAmount(m[1]));
  }
  return stated.filter((n) => Number.isFinite(n) && !known.some((k) => Math.abs(k - n) < 0.005));
}
