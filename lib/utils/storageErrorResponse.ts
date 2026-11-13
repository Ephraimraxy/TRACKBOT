import { NextResponse } from "next/server";

import { StorageError, type StorageErrorCode } from "@/lib/helpers/storage";

const STATUS: Record<StorageErrorCode, number> = {
  NOT_CONFIGURED: 503,
  INVALID_FILE: 400,
  TOO_LARGE: 413,
  UPLOAD_FAILED: 502,
};

/** A JSON response for a StorageError, or null when the error is something else. */
export function storageErrorResponse(error: unknown) {
  if (!(error instanceof StorageError)) return null;
  return NextResponse.json({ error: error.message }, { status: STATUS[error.code] });
}
