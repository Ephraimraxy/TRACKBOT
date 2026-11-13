import { NextResponse } from "next/server";

import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { FaqError, type FaqErrorCode } from "@/lib/services/faqService";

const STATUS_BY_CODE: Record<FaqErrorCode, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID: 400,
};

export function faqErrorResponse(error: unknown, context: string) {
  if (error instanceof FaqError) {
    return NextResponse.json({ error: error.message }, { status: STATUS_BY_CODE[error.code] });
  }
  console.error(`API Error [${context}]:`, error);
  return NextResponse.json({ error: ERROR_MESSAGES.INTERNAL_ERROR }, { status: 500 });
}
