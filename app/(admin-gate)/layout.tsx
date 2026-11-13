import Image from "next/image";
import Link from "next/link";

import { BRAND } from "@/lib/config/brand";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";

// The administrator's sign-in has its own plain page: no shop header, cart or customer links.
export default function AdminGateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-6 bg-[#ebedf0] p-6 md:p-10">
      <Link href="/" className="flex items-center gap-2">
        <Image src="/manifest/favicon.svg" height={48} width={48} alt={`${BRAND.name} logo`} />
        <span className="text-2xl font-bold">{BRAND.name}</span>
      </Link>
      {children}
      <LanguageSwitcher />
    </main>
  );
}
