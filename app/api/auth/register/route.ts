import bcrypt from "bcryptjs";
import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/utils/prisma";
import { UserRole } from "@prisma/client";
import { signIn } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { registerSchema, formatValidationErrors } from "@/lib/validations";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Parse input data
    const parseResult = registerSchema.safeParse(body);
    if (!parseResult.success) {
      return formatValidationErrors(parseResult);
    }

    const { email, password, nom, prenom } = parseResult.data;

    // The administrator's email is reserved: nobody can register with it, and the answer is the
    // same as for any other taken address, so it does not reveal who the administrator is.
    const isAdminEmail = email === process.env.ADMIN_EMAIL?.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser || isAdminEmail) {
      return NextResponse.json(
        { error: "This email address is already in use" },
        { status: 409 }
      );
    }

    // Hash password & create user
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        nom,
        prenom,
        role: UserRole.CLIENT,
        client: {
          create: {},
        },
      },
    });

    // Sign in user (create session)
    await signIn("credentials", { email, password, redirect: false });

    return NextResponse.json(
      { message: "Registration successful" },
      { status: 201 }
    );
  } catch (error) {
    console.error("API Error : ", error);
    return NextResponse.json(
      { error: ERROR_MESSAGES.INTERNAL_ERROR },
      { status: 500 }
    );
  }
}
