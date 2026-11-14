"use client";

import { T } from "@/components/i18n/T";
import PaymentStatus from "@/components/common/PaymentStatus";
import { useI18n } from "@/components/i18n/LocaleProvider";

import Image from "next/image";
import Link from "next/link";

import { extractDateString } from "@/lib/utils";
import { OrderFromAPI } from "@/lib/types/order.types";
import { getStatusColor, getStatusLabel } from "@/lib/helpers/orderStatus";

interface OrderTableProps {
  orders: OrderFromAPI[];
  setSelectedOrder: (order: OrderFromAPI) => void;
}

export default function OrderTable({
  orders,
  setSelectedOrder,
}: OrderTableProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col lg:flex-row-reverse gap-6 sm:gap-8">
      {/* Image (100% sur mobile, 40% sur desktop) */}
      <div className="w-full lg:w-2/5 flex items-center justify-center">
        <Image
          height={300}
          width={300}
          src="/images/list-orders.png"
          alt={t("Order history")}
          className="w-auto h-auto max-w-full max-h-64 object-contain"
          priority
        />
      </div>

      {/* Tableau réduit (100% sur mobile, 60% sur desktop) */}
      <div className="w-full lg:w-3/5 bg-white rounded-xl shadow-lg overflow-hidden">
        {/* Structure de table unique avec en-tête fixe et corps défilant */}
        <div className="overflow-hidden">
          {/* En-tête du tableau (fixe) */}
          <div className="bg-black text-white">
            <table className="w-full table-fixed">
              <thead>
                <tr>
                  <th className="w-1/5 px-4 sm:px-6 py-3 sm:py-4 text-left text-xs sm:text-sm font-semibold">
                    <T>No.</T>
                  </th>
                  <th className="w-1/5 px-4 sm:px-6 py-3 sm:py-4 text-left text-xs sm:text-sm font-semibold">
                    <T>Date</T>
                  </th>
                  <th className="w-1/5 px-4 sm:px-6 py-3 sm:py-4 text-left text-xs sm:text-sm font-semibold">
                    <T>Status</T>
                  </th>
                  <th className="w-1/5 px-4 sm:px-6 py-3 sm:py-4 text-left text-xs sm:text-sm font-semibold">
                    <T>Items</T>
                  </th>
                  <th className="w-1/5 px-4 sm:px-6 py-3 sm:py-4 text-left text-xs sm:text-sm font-semibold">
                    <T>Total</T>
                  </th>
                </tr>
              </thead>
            </table>
          </div>

          {/* Corps du tableau avec défilement (5 lignes maximum) */}
          <div className="max-h-[20rem] overflow-y-auto">
            <table className="w-full table-fixed">
              <tbody>
                {orders.map((order, index) => (
                  <tr
                    key={order.id}
                    className="hover:bg-gray-50 transition-all duration-200 cursor-pointer border-b-1 border-gray-200"
                    onClick={() => setSelectedOrder(order)}
                  >
                    <td className="w-1/5 px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900">
                      {index + 1}
                    </td>
                    <td className="w-1/5 px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900">
                      {extractDateString(order.date)}
                    </td>
                    <td className="w-1/5 px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm">
                      <span
                        className={`px-3 py-1 rounded-full font-medium ${getStatusColor(
                          order.statut!
                        )}`}
                      >
                        <T>{getStatusLabel(order.statut)}</T>
                      </span>
                      {order.statut === "EN_LIVRAISON" ? (
                        <Link
                          href={`/client/orders/${order.id}/track`}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700"
                        >
                          <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                          <T>Track live</T>
                        </Link>
                      ) : (
                        <Link
                          href={`/client/orders/${order.id}/track`}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 block text-xs text-blue-600 underline"
                        >
                          <T>Track</T>
                        </Link>
                      )}
                      <PaymentStatus
                        orderId={order.id}
                        payment={order.paiement}
                        canPay={order.statut !== "ANNULEE"}
                      />
                    </td>
                    <td className="w-1/5 px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm font-semibold text-gray-900">
                      {order.produits.length}
                    </td>
                    <td className="w-1/5 px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm font-semibold text-gray-900">
                      ₦{order.montant.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
