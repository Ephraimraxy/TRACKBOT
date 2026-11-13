"use client";

import { useSession } from "next-auth/react";

import DeliveryUpdates from "@/components/portal/client/settingspage/DeliveryUpdates";

/** The delivery person's alert options: a sound and background alerts for new assignments. */
export default function DriverSettingsPage() {
  const { data: session } = useSession();
  if (!session?.user?.id) return null;
  return (
    <div className="mx-auto max-w-xl p-4 md:p-6">
      <DeliveryUpdates userId={session.user.id} showReminders={false} />
    </div>
  );
}
