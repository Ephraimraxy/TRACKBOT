import { NextResponse } from "next/server";

import { prisma } from "@/lib/utils/prisma";

export const dynamic = "force-dynamic";

// GET: liveness and database check for the hosting platform. Reveals nothing about the configuration.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
