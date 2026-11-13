"use client";

import { Settings2 } from "lucide-react";

import { T } from "@/components/i18n/T";
import DeliveryUpdates from "@/components/portal/client/settingspage/DeliveryUpdates";

/**
 * The alert timing and pop-up choices, shown right on the Notifications page so nobody has to hunt for them.
 * Customers choose how often they are reminded where their delivery is; everyone can choose the sound and
 * background pop-ups.
 */
export default function AlertSettingsPanel({ userId, showReminders = true }: { userId: string; showReminders?: boolean }) {
  return (
    <details open className="mb-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm sm:p-6" data-testid="alert-settings">
      <summary className="flex cursor-pointer items-center gap-2 text-base font-semibold text-gray-900 sm:text-lg">
        <Settings2 className="h-5 w-5" />
        <T>Alert timing and pop-ups</T>
      </summary>
      <div className="mt-4">
        <DeliveryUpdates userId={userId} showReminders={showReminders} />
      </div>
    </details>
  );
}
