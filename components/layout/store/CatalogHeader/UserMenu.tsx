"use client";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useAppDispatch } from "@/redux/hooks";
import { clearCart } from "@/redux/features/carts/cartsSlice";

// UI components
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const UserMenu = () => {
  const { t } = useI18n();
  const router = useRouter();
  const { data: session } = useSession();

  const dispatch = useAppDispatch();

  const handleLogout = async () => {
    try {
      await signOut({ redirect: false });
      dispatch(clearCart());
      toast(t("Logged out successfully"));
      router.push("/");
      router.refresh();
    } catch (error) {
      console.error("Logout failed:", error);
      toast(t("Error while logging out"));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="p-1 md:p-2">
          <Image
            priority
            src="/icons/user.svg"
            height={30}
            width={30}
            alt={t("user")}
            className="cursor-pointer w-auto h-[24px] sm:h-[26px] md:h-[28px] lg:h-[30px]"
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        {session ? (
          session.user.role === "ADMIN" ? (
            <>
              <DropdownMenuItem asChild>
                <Link href="/admin/dashboard"><T>Admin portal</T></Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>
                <T>Log out</T>
              </DropdownMenuItem>
            </>
          ) : session.user.role === "VENDEUR" ? (
            <>
              <DropdownMenuItem asChild>
                <Link href="/vendor/dashboard"><T>Vendor portal</T></Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>
                <T>Log out</T>
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem asChild>
                <Link href="/client/settings"><T>Settings</T></Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/client/notifications"><T>Notifications</T></Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/client/orders"><T>Orders</T></Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>
                <T>Log out</T>
              </DropdownMenuItem>
            </>
          )
        ) : (
          <>
            <DropdownMenuItem asChild>
              <Link href="/auth/register"><T>Sign up</T></Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/auth/login"><T>Log in</T></Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserMenu;
