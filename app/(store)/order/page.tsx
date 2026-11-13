import RestrictedAccess from "@/components/common/RestrictedAccess";
import OrderPageMain from "@/components/store/orderpage";
import { auth } from "@/lib/auth";
import { UserRole } from "@prisma/client";

export default async function OrderPage() {
  const session = await auth();

  if (!session) {
    return <RestrictedAccess />;
  }

  if (session.user.role !== UserRole.CLIENT) {
    return (
      <RestrictedAccess message="You do not have permission to access this page, which is reserved for customers only." />
    );
  }

  return <OrderPageMain />;
}
