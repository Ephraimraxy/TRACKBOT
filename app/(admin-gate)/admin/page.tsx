import type { Metadata } from "next";

import { AdminLoginForm } from "@/components/auth/AdminLoginForm";

export const metadata: Metadata = {
  title: "Administrator sign-in",
  // The owner's address is not advertised to search engines.
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <div className="w-full max-w-sm">
      <AdminLoginForm />
    </div>
  );
}
