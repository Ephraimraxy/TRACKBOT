import type { NextRequest } from "next/server";

/**
 * The public address of this site, used to tell Paystack where to send the customer back to.
 * APP_URL wins when set; otherwise the proxy headers (Railway sets them), then the request itself.
 */
export function appOrigin(req: NextRequest, env: Record<string, string | undefined> = process.env): string {
  const configured = (env.APP_URL ?? env.NEXTAUTH_URL)?.trim();
  if (configured && /^https?:\/\//.test(configured)) return configured.replace(/\/$/, "");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}
