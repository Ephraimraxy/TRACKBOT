"use client";

import { useParams } from "next/navigation";

import OrderTrackingView from "@/components/tracking/OrderTrackingView";

export default function TrackOrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  return <OrderTrackingView orderId={orderId} audience="customer" />;
}
