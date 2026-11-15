import { isUsableKey } from "@/lib/chatbot/providers";
import { resolveRouting } from "@/lib/config/routing";

export class EnvError extends Error {
  constructor(public missing: string[]) {
    super(
      `Missing or invalid environment variables: ${missing.join(", ")}. ` +
        "Copy .env.example to .env and fill them in."
    );
    this.name = "EnvError";
  }
}

/**
 * Check the configuration at server start. Values are never printed, only variable names.
 *  - Required: the database URL and an auth secret (at least 16 characters).
 *  - Optional: AI provider keys (without any, the chatbot uses its rule-based mode)
 *    and image/email services (those features are disabled without them).
 * Returns warnings for missing optional settings; throws EnvError for missing required ones.
 */
export function validateEnv(env: Record<string, string | undefined> = process.env): { warnings: string[] } {
  const missing: string[] = [];

  if (!env.DATABASE_URL?.trim()) missing.push("DATABASE_URL");

  const secret = env.AUTH_SECRET || env.NEXTAUTH_SECRET || env.JWT_SECRET;
  if (!secret || secret.length < 16) missing.push("AUTH_SECRET (at least 16 characters)");

  if (missing.length > 0) throw new EnvError(missing);

  const warnings: string[] = [];
  const providers = ["DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"].filter((k) => isUsableKey(env[k]));
  if (providers.length === 0) {
    warnings.push("No AI provider key set: the chatbot will use its built-in rule-based answers.");
  }
  // Accepted aliases: R2_BUCKET_NAME for R2_BUCKET, R2_PUBLIC_URL for NEXT_PUBLIC_R2_PUBLIC_URL.
  const has = (...names: string[]) => names.some((n) => env[n]?.trim());
  const r2Missing = [
    has("R2_ACCOUNT_ID") ? null : "R2_ACCOUNT_ID",
    has("R2_ACCESS_KEY_ID") ? null : "R2_ACCESS_KEY_ID",
    has("R2_SECRET_ACCESS_KEY") ? null : "R2_SECRET_ACCESS_KEY",
    has("R2_BUCKET", "R2_BUCKET_NAME") ? null : "R2_BUCKET",
    has("NEXT_PUBLIC_R2_PUBLIC_URL", "R2_PUBLIC_URL") ? null : "NEXT_PUBLIC_R2_PUBLIC_URL",
  ].filter((x): x is string => x !== null);
  if (r2Missing.length > 0) {
    warnings.push(`Cloudflare R2 is not fully configured (missing: ${r2Missing.join(", ")}): image uploads and product photos will not work.`);
  }
  if (!has("RESEND_API_KEY") || !has("RESEND_FROM_EMAIL")) {
    warnings.push("Email is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL): verification and reset emails will not be sent.");
  }
  if (!has("PAYSTACK_SECRET_KEY")) {
    warnings.push("Online payment is not configured (PAYSTACK_SECRET_KEY): customers can place orders but cannot pay.");
  }
  const routing = resolveRouting(env);
  if (!routing.usable) {
    warnings.push(`Road routing is not available: ${routing.reason} Customers and delivery people will see a straight-line estimate, clearly marked as one, with no turn-by-turn directions.`);
  }
  return { warnings };
}
