import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paystack, over its HTTP API. The customer never types a card number into this app: they are sent to
 * Paystack's own page, where they pay by card, bank transfer, USSD, bank, or whatever your Paystack
 * account has switched on. This server then asks Paystack whether the money arrived.
 *
 * Only the SECRET key is used here (PAYSTACK_SECRET_KEY). It never leaves the server.
 */

export type PaymentErrorCode =
  | "NOT_CONFIGURED"
  | "GATEWAY_ERROR"
  | "ORDER_NOT_FOUND"
  | "ORDER_CANCELLED"
  | "ALREADY_PAID"
  | "PAYMENT_NOT_FOUND"
  | "BAD_SIGNATURE";

export class PaymentError extends Error {
  constructor(
    public code: PaymentErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

export interface PaystackTransaction {
  /** "success", "failed", "abandoned", "pending", ... as Paystack reports it. */
  status: string;
  reference: string;
  /** In kobo (1 naira = 100 kobo). */
  amount: number;
  currency: string;
  /** card, bank_transfer, ussd, bank, qr, mobile_money, ... */
  channel: string | null;
  paidAt: string | null;
}

export interface PaystackClient {
  initialize(args: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ authorizationUrl: string; reference: string }>;
  verify(reference: string): Promise<PaystackTransaction>;
}

const BASE = "https://api.paystack.co";

type FetchLike = typeof fetch;

export function createPaystackClient(secretKey: string, fetchImpl: FetchLike = fetch): PaystackClient {
  const call = async (path: string, init?: RequestInit) => {
    let res: Response;
    try {
      res = await fetchImpl(`${BASE}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new PaymentError("GATEWAY_ERROR", "Could not reach Paystack. Please try again.");
    }
    const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: Record<string, unknown> } | null;
    if (!res.ok || !body?.status || !body.data) {
      // Paystack's own message is safe to log; it never contains our key.
      console.error("[paystack] request failed:", res.status, body?.message ?? "no message");
      throw new PaymentError("GATEWAY_ERROR", "Paystack could not process the request. Please try again.");
    }
    return body.data;
  };

  return {
    async initialize({ email, amountKobo, reference, callbackUrl, metadata }) {
      const data = await call("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email,
          amount: amountKobo,
          currency: "NGN",
          reference,
          callback_url: callbackUrl,
          metadata,
        }),
      });
      const url = data.authorization_url;
      if (typeof url !== "string" || !url.startsWith("https://")) {
        throw new PaymentError("GATEWAY_ERROR", "Paystack did not return a payment page.");
      }
      return { authorizationUrl: url, reference: String(data.reference ?? reference) };
    },

    async verify(reference) {
      const data = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
      return toTransaction(data);
    },
  };
}

/** Normalise Paystack's transaction object (the same shape in the verify call and in webhooks). */
export function toTransaction(data: Record<string, unknown>): PaystackTransaction {
  return {
    status: String(data.status ?? ""),
    reference: String(data.reference ?? ""),
    amount: Number(data.amount ?? 0),
    currency: String(data.currency ?? ""),
    channel: typeof data.channel === "string" ? data.channel : null,
    paidAt: typeof data.paid_at === "string" ? data.paid_at : null,
  };
}

/** The client for the configured secret key, or a clear error when payments are not set up. */
export function getPaystackClient(env: Record<string, string | undefined> = process.env): PaystackClient {
  const key = env.PAYSTACK_SECRET_KEY?.trim();
  if (!key) throw new PaymentError("NOT_CONFIGURED", "Online payment is not set up yet.");
  return createPaystackClient(key);
}

/**
 * Paystack signs every webhook: the header x-paystack-signature is the HMAC-SHA512 of the raw request
 * body, keyed with the secret key. Anything else is not from Paystack and must be ignored.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secretKey: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
