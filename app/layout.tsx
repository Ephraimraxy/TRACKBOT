import type { Metadata, Viewport } from "next";
import HolyLoader from "holy-loader";

// styles
import "@/styles/globals.css";
import { satoshi } from "@/styles/fonts";

// components
import { Toaster } from "@/components/ui/sonner";
import Providers from "@/app/providers";
import ChatComponent from "@/components/common/ChatComponent";
import { BRAND } from "@/lib/config/brand";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { getLocale } from "@/lib/i18n/server";

export const viewport: Viewport = {
  themeColor: "#000000",
};

export const metadata: Metadata = {
  title: {
    default: BRAND.name,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.tagline,
};

export default async function GlobalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body className={satoshi.className}>
        <HolyLoader color="#868686" />
        <LocaleProvider initialLocale={locale}>
          <Providers>
            {children}
            <Toaster />
            <ChatComponent />
          </Providers>
        </LocaleProvider>
      </body>
    </html>
  );
}
