import StoreHeader from "@/components/layout/store/Header";
import StoreFooter from "@/components/layout/store/Footer";

export default function PaymentLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <StoreHeader />
      {children}
      <StoreFooter />
    </>
  );
}
