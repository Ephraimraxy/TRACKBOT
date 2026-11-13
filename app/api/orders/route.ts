import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/utils/prisma";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import {
  getPaginationParams,
  getSortingOrdersParams,
} from "@/lib/utils/params";
import { Prisma, UserRole } from "@prisma/client";
import { formatOrderData, getOrderSelect } from "@/lib/helpers/orders";
import {
  formatValidationErrors,
  createOrderSchema,
} from "@/lib/validations";
import { createOrder, OrderError } from "@/lib/services/orderService";

// GET & Search all orders for admin only
export async function GET(request: NextRequest) {
  const session = await auth();

  // Authentication and authorization check
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 }
    );
  }

  if (session.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 }
    );
  }

  // Pagination & Sorting
  const { page, pageSize, skip } = getPaginationParams(request);
  const { sortBy, sortOrder } = getSortingOrdersParams(request);

  // Search
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search");

  // Construct the filter
  const whereClause: Prisma.CommandeWhereInput = {
    ...(search && {
      OR: [
        { id: search },
        {
          lignesCommande: {
            some: {
              nomProduit: {
                contains: search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          },
        },
        {
          client: {
            user: {
              nom: {
                contains: search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          },
        },
        {
          client: {
            user: {
              prenom: {
                contains: search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          },
        },
      ],
    }),
  };

  try {
    const total = await prisma.commande.count({
      where: whereClause,
    });

    const commandes = await prisma.commande.findMany({
      where: whereClause,
      orderBy: {
        [sortBy]: sortOrder,
      },
      select: getOrderSelect(),
      take: pageSize,
      skip,
    });

    const formattedData = commandes.map(formatOrderData);

    const pagination = {
      totalItems: total,
      totalPages: Math.ceil(total / pageSize),
      currentPage: page,
      pageSize,
    };

    return NextResponse.json(
      {
        message: "Orders retrieved successfully",
        pagination,
        data: formattedData,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("API Error [GET /api/orders]:", error);
    return NextResponse.json(
      { error: ERROR_MESSAGES.INTERNAL_ERROR },
      { status: 500 }
    );
  }
}

// POST: Create a new order (client only)
export async function POST(req: NextRequest) {
  const session = await auth();

  // Check authentication
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 }
    );
  }

  // Check authorization
  if (session.user.role !== UserRole.CLIENT) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = createOrderSchema.safeParse(body);

  if (!parsed.success) {
    return formatValidationErrors(parsed);
  }

  const { userId, addresse, produits } = parsed.data;

  if (session.user.id !== userId) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 }
    );
  }

  try {
    // Atomic: stock check/decrement, address, order, payment and history.
    const { order, paiement } = await createOrder(prisma, {
      userId,
      addresse,
      produits,
    });

    const formattedOrder = formatOrderData({ ...order, paiement });

    return NextResponse.json(
      {
        message: "Order placed. Payment is still to be made.",
        data: formattedOrder,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof OrderError) {
      if (error.code === "PRODUCT_NOT_FOUND") {
        return NextResponse.json(
          { error: ERROR_MESSAGES.BAD_REQUEST_ID },
          { status: 400 }
        );
      }
      if (error.code === "INSUFFICIENT_STOCK") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
    }

    console.error("API Error [POST /api/orders]:", error);
    return NextResponse.json(
      { error: ERROR_MESSAGES.INTERNAL_ERROR },
      { status: 500 }
    );
  }
}
