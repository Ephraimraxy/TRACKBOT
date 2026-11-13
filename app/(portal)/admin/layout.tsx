"use client";

import { useSession } from "next-auth/react";
import { NavItem } from "@/lib/types/ui/portalSideBar.types";
import { getImageUrlFromPublicId } from "@/lib/utils";

// Components
import SidebarLayout from "@/components/layout/portal/Sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Get session data: session !== null bcz we are in a protected route
  const { data: session } = useSession();
  const user = session?.user;

  // Admin user information
  const adminInfo = {
    name: `${user?.prenom} ${user?.nom}`,
    email: user?.email as string,
    photoUrl: user?.imagePublicId
      ? getImageUrlFromPublicId(user?.imagePublicId)
      : null,
    role: "Administrator" as const,
    badgeColor: "bg-blue-100 text-blue-800",
  };

  // Navigation items
  const navItems: NavItem[] = [
    {
      name: "Dashboard",
      href: "/admin/dashboard",
      iconName: "BarChart2",
    },
    { name: "Management", href: "/admin/management", iconName: "Briefcase" },
    { name: "Shop", href: "/admin/store", iconName: "ShoppingBag" },
    { name: "Sales", href: "/admin/sells", iconName: "DollarSign" },
    { name: "Orders", href: "/admin/orders", iconName: "Package" },
    { name: "Deliveries", href: "/admin/deliveries", iconName: "Truck" },
    { name: "Chatbot FAQ", href: "/admin/faq", iconName: "HelpCircle" },
    { name: "Reports", href: "/admin/reports", iconName: "ShieldAlert" },
    { name: "Notifications", href: "/admin/notifications", iconName: "Bell" },
    { name: "Settings", href: "/admin/settings", iconName: "Settings" },
  ];

  return (
    <SidebarLayout navItems={navItems} userInfo={adminInfo}>
      {children}
    </SidebarLayout>
  );
}
