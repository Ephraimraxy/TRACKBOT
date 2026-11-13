import { Suspense } from "react";

import RestrictedAccess from "@/components/common/RestrictedAccess";
import PaymentResult from "@/components/store/payment/PaymentResult";
import { auth } from "@/lib/auth";
import { UserRole } from "@prisma/client";

/** Paystack sends the customer here after they pay (or give up). We then ask Paystack what happened. */
export default async function PaymentCallbackPage() {
  const session = await auth();
  if (!session) return <RestrictedAccess />;
  if (session.user.role !== UserRole.CLIENT) {
    return <RestrictedAccess message="You do not have permission to access this page, which is reserved for customers only." />;
  }

  return (
    <Suspense fallback={null}>
      <PaymentResult />
    </Suspense>
  );
}
