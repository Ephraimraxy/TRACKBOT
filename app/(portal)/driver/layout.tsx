"use client";

import { useSession } from "next-auth/react";

import { NavItem } from "@/lib/types/ui/portalSideBar.types";
import SidebarLayout from "@/components/layout/portal/Sidebar";

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const user = session?.user;

  const driverInfo = {
    name: `${user?.prenom} ${user?.nom}`,
    email: user?.email as string,
    photoUrl: null,
    role: "Delivery person" as const,
    badgeColor: "bg-green-100 text-green-800",
  };

  const navItems: NavItem[] = [
    { name: "My deliveries", href: "/driver/deliveries", iconName: "Truck" },
    { name: "Alerts", href: "/driver/settings", iconName: "Bell" },
  ];

  return (
    <SidebarLayout navItems={navItems} userInfo={driverInfo}>
      {children}
    </SidebarLayout>
  );
}
