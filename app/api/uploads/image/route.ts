import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";

import { auth } from "@/lib/auth";
import { ALLOWED_FOLDERS, ERROR_MESSAGES } from "@/lib/constants/settings";
import { requireStorage } from "@/lib/helpers/storage";
import { storageErrorResponse } from "@/lib/utils/storageErrorResponse";

// POST: the shop owner uploads one image to R2 storage; returns the object key to save.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }
  if (session.user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const folder = formData.get("folder");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file found." }, { status: 400 });
    }
    if (typeof folder !== "string" || !ALLOWED_FOLDERS.includes(folder)) {
      return NextResponse.json({ error: "Invalid folder name." }, { status: 400 });
    }

    const { key } = await requireStorage().uploadImage(file, folder);

    return NextResponse.json(
      { message: "Image uploaded.", data: { publicId: key } },
      { status: 200 }
    );
  } catch (error) {
    const known = storageErrorResponse(error);
    if (known) return known;
    console.error("Upload failed:", error);
    return NextResponse.json({ error: ERROR_MESSAGES.INTERNAL_ERROR }, { status: 500 });
  }
}
