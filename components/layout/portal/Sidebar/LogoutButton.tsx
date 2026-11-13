"use client";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { useAppDispatch } from "@/redux/hooks";
import { clearCart } from "@/redux/features/carts/cartsSlice";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

interface LogoutButtonProps {
  isCollapsed: boolean;
  isMobile: boolean;
}

export default function LogoutButton({
  isCollapsed,
  isMobile,
}: LogoutButtonProps) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const dispatch = useAppDispatch();

  return (
    <div className="p-4 border-t border-gray-200">
      <button
        className={`flex items-center ${
          isMobile
            ? "px-6 py-4 gap-3"
            : `${isCollapsed ? "justify-center px-2" : "gap-4 px-6"} py-3`
        } w-full text-gray-700 hover:bg-red-50 hover:text-red-600 transition-all duration-200 rounded-lg`}
        onClick={async (e) => {
          e.stopPropagation();
          // Logout logic
          try {
            await signOut({ redirect: false });
            dispatch(clearCart());
            toast(t("Logged out successfully"));
            // The administrator signs back in at /admin, everyone else starts from the shop.
            router.push(pathname.startsWith("/admin") ? "/admin" : "/");
            router.refresh();
          } catch (error) {
            console.error("Logout failed:", error);
            toast(t("Error while logging out"));
          }
        }}
      >
        <LogOut className={`${isMobile ? "h-6 w-6" : "h-5 w-5"}`} />
        {(!isCollapsed || isMobile) && <span><T>Log out</T></span>}
      </button>
    </div>
  );
}
