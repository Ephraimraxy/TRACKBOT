import { NextResponse } from "next/server";

import { PaymentError } from "@/lib/payments/paystack";

const STATUS: Record<PaymentError["code"], number> = {
  NOT_CONFIGURED: 503,
  GATEWAY_ERROR: 502,
  ORDER_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  ORDER_CANCELLED: 409,
  ALREADY_PAID: 409,
  BAD_SIGNATURE: 401,
};

/** The JSON answer for a payment problem, or null when the error is not a PaymentError. */
export function paymentErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof PaymentError)) return null;
  return NextResponse.json({ error: error.message, code: error.code }, { status: STATUS[error.code] });
}
