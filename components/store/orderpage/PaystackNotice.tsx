import { T } from "@/components/i18n/T";
import { satoshi } from "@/styles/fonts";
import { cn } from "@/lib/utils";
import { Landmark, Lock } from "lucide-react";

/**
 * Where the card form used to be. No card details are typed into this shop: the customer pays on
 * Paystack's own secure page, which offers whichever methods the shop has switched on there.
 */
export default function PaystackNotice() {
  return (
    <div className="p-6 sm:p-8 rounded-2xl border border-black/10 shadow-md bg-white">
      <h3 className={cn(satoshi.className, "text-xl md:text-2xl font-bold text-black mb-4 flex items-center gap-3")}>
        <Landmark className="h-6 w-6" />
        <T>Payment</T>
      </h3>
      <p className="text-sm sm:text-base text-black/70">
        <T>After you place the order you will pay securely on Paystack, by card, bank transfer, USSD or bank, whichever you prefer.</T>
      </p>
      <p className="mt-3 flex items-center gap-2 text-xs sm:text-sm text-black/60">
        <Lock className="h-4 w-4" />
        <T>Your card details are never entered or stored on this site.</T>
      </p>
    </div>
  );
}
