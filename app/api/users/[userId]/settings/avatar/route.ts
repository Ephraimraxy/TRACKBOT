import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/utils/prisma";
import { auth } from "@/lib/auth";
import { deleteStoredImage, requireStorage } from "@/lib/helpers/storage";
import { storageErrorResponse } from "@/lib/utils/storageErrorResponse";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import {
  formatValidationErrors,
  updateUserAvatarSchema,
} from "@/lib/validations";

// GET avatar (imagePublicId)
export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const session = await auth();

  // Authentication Check
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 }
    );
  }

  // Check if the user is trying to access their own data
  if (session.user.id !== userId) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 }
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        imagePublicId: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // RETURN the response
    return NextResponse.json(
      {
        message: "The user's avatar was retrieved successfully",
        data: { imagePublicId: user.imagePublicId },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "API Error [GET /api/users/[userId]/settings/avatar]:",
      error
    );
    return NextResponse.json(
      { error: ERROR_MESSAGES.INTERNAL_ERROR },
      { status: 500 }
    );
  }
}

// PUT avatar (update imagePublicId)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const session = await auth();

  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 }
    );
  }

  if (session.user.id !== userId) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    // Parse and validate the file
    const parsed = updateUserAvatarSchema.safeParse({ file });
    if (!parsed.success) {
      return formatValidationErrors(parsed, "Invalid file");
    }

    // Get current imagePublicId
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { imagePublicId: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Upload new avatar to R2 storage
    const uploaded = await requireStorage().uploadImage(file, "avatars");

    // Delete old avatar if exists
    if (user.imagePublicId) {
      await deleteStoredImage(user.imagePublicId);
    }

    // Update user with new imagePublicId
    await prisma.user.update({
      where: { id: userId },
      data: { imagePublicId: uploaded.key },
    });

    return NextResponse.json(
      {
        message: "Avatar updated successfully",
        data: { imagePublicId: uploaded.key },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "API Error [PUT /api/users/[userId]/settings/avatar]:",
      error
    );
    return NextResponse.json(
      { error: ERROR_MESSAGES.INTERNAL_ERROR },
      { status: 500 }
    );
  }
}

// DELETE avatar
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const session = await auth();

  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 }
    );
  }

  if (session.user.id !== userId) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 }
    );
  }

  try {
    // Get current imagePublicId
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { imagePublicId: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Delete avatar from R2 storage if it exists
    if (user.imagePublicId) {
      await deleteStoredImage(user.imagePublicId);
    }

    // Remove imagePublicId from the database
    await prisma.user.update({
      where: { id: userId },
      data: { imagePublicId: null },
    });

    return NextResponse.json(
      { message: "Avatar deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "API Error [DELETE /api/users/[userId]/settings/avatar]:",
      error
    );
    return NextResponse.json(
      { error: ERROR_MESSAGES.INTERNAL_ERROR },
      { status: 500 }
    );
  }
}
