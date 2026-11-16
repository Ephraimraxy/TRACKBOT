"use client";

import { useParams } from "next/navigation";

import OrderTrackingView from "@/components/tracking/OrderTrackingView";

// The shop owner can watch any order's delivery live, whoever placed it.
export default function AdminTrackOrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  return <OrderTrackingView orderId={orderId} audience="admin" />;
}
