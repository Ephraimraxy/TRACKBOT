import { T } from "@/components/i18n/T";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { satoshi } from "@/styles/fonts";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

/**
 * Shown only when the order was saved but the Paystack page could not be opened (a hiccup, or online
 * payment not set up yet). The order is safe in the customer's history, where "Pay now" tries again.
 * When the payment page does open, the customer is sent there directly and never sees this.
 */
const IsOrderSuccessful = ({ paymentError }: { paymentError?: string | null }) => {
  return (
    <main className="min-h-[calc(100dvh-125px)] py-10 bg-[#ebedf0] flex flex-col">
      <div className="flex-1 flex flex-col max-w-frame mx-auto px-4 xl:px-0">
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 sm:p-8 rounded-2xl border border-black/10 shadow-md bg-white">
          <AlertTriangle className="h-16 w-16 text-amber-500 mb-4" />
          <h2 className={cn(satoshi.className, "text-2xl md:text-3xl font-bold text-black mb-4")}>
            <T>Your order is saved, but it is not paid yet</T>
          </h2>
          {paymentError && <p className="mb-2 text-black/70">{paymentError}</p>}
          <p className="mb-8 max-w-md text-black/70">
            <T>You can pay at any time from your order history using the Pay now button.</T>
          </p>
          <Link href="/client/orders">
            <Button
              className={cn(
                satoshi.className,
                "text-sm md:text-base font-medium bg-gradient-to-r from-gray-800 to-black rounded-full py-4 px-6 text-white hover:from-gray-900 hover:to-black transition-all shadow-lg hover:shadow-xl"
              )}
            >
              <T>View order history</T>
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
};

export default IsOrderSuccessful;
