import { T } from "@/components/i18n/T";
import Link from "next/link";

import { BRAND } from "@/lib/config/brand";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";

const Footer = () => {
  return (
    <footer className="bg-[#F0F0F0] mt-10">
      <div className="max-w-frame mx-auto px-4 py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold">{BRAND.name}</p>
            <p className="text-sm text-black/60 max-w-md"><T>{BRAND.tagline}</T></p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/catalog" className="hover:underline">
              <T>Shop</T>
            </Link>
            <Link href="/client/orders" className="hover:underline">
              <T>My orders</T>
            </Link>
            <Link href="/about" className="hover:underline">
              <T>About this project</T>
            </Link>
          </nav>
        </div>
        <hr className="my-4 border-black/10" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-black/60">
            © {BRAND.year} {BRAND.name}. {BRAND.degree} <T>project,</T> {BRAND.institution}.
          </p>
          <LanguageSwitcher />
        </div>
      </div>
    </footer>
  );
};

export default Footer;
