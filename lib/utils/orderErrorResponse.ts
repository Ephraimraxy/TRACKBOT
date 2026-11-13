import { NextResponse } from "next/server";

import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { OrderError, type OrderErrorCode } from "@/lib/services/orderService";

const STATUS_BY_CODE: Record<OrderErrorCode, number> = {
  ORDER_NOT_FOUND: 404,
  FORBIDDEN: 403,
  PRODUCT_NOT_FOUND: 400,
  INVALID_DRIVER: 400,
  INSUFFICIENT_STOCK: 409,
  INVALID_TRANSITION: 409,
  NOT_ASSIGNABLE: 409,
  INVALID_LOCATION: 400,
  TRACKING_INACTIVE: 409,
  TOO_FREQUENT: 429,
};

/** Turn a service error into a JSON response; anything unexpected becomes a 500. */
export function orderErrorResponse(error: unknown, context: string) {
  if (error instanceof OrderError) {
    return NextResponse.json(
      { error: error.message },
      { status: STATUS_BY_CODE[error.code] }
    );
  }
  console.error(`API Error [${context}]:`, error);
  return NextResponse.json(
    { error: ERROR_MESSAGES.INTERNAL_ERROR },
    { status: 500 }
  );
}
