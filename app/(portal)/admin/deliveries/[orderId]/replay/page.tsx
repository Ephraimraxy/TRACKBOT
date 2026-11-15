"use client";

import { useParams } from "next/navigation";

import DeliveryReplay from "@/components/tracking/DeliveryReplay";

// The shop owner replays how a delivery moved, and sees what the GPS did.
export default function AdminReplayPage() {
  const { orderId } = useParams<{ orderId: string }>();
  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="mb-3 text-xl font-bold">Delivery replay</h1>
      <DeliveryReplay orderId={orderId} />
    </div>
  );
}
