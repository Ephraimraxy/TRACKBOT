"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle, Clock, Loader2, XCircle } from "lucide-react";

import { T } from "@/components/i18n/T";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { satoshi } from "@/styles/fonts";

type Outcome = "checking" | "paid" | "pending" | "failed" | "mismatch" | "error";

/**
 * What the customer sees after Paystack. The words come from asking Paystack (through our server),
 * never from the address bar, so nobody can mark an order paid by editing the link.
 */
export default function PaymentResult() {
  const params = useSearchParams();
  // Paystack sends the transaction reference as `reference` (and also `trxref`).
  const reference = params.get("reference") ?? params.get("trxref");
  const [outcome, setOutcome] = useState<Outcome>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  const check = useCallback(async () => {
    if (!reference) {
      setOutcome("error");
      setMessage("This page needs a payment reference.");
      return;
    }
    setOutcome("checking");
    try {
      const res = await fetch("/api/payments/paystack/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOutcome("error");
        setMessage(json.error ?? "We could not check this payment.");
        return;
      }
      setOutcome(json.status as Outcome);
    } catch {
      setOutcome("error");
      setMessage("We could not reach the server. Check your connection and try again.");
    }
  }, [reference]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void check();
  }, [check]);

  const view = {
    checking: { icon: <Loader2 className="h-16 w-16 animate-spin text-gray-500" />, title: "Checking your payment…", body: "Please wait while we confirm it with Paystack." },
    paid: { icon: <CheckCircle className="h-16 w-16 text-green-500" />, title: "Payment received", body: "Thank you! Your order is paid and the shop will start preparing it." },
    pending: { icon: <Clock className="h-16 w-16 text-amber-500" />, title: "Waiting for your payment", body: "Paystack has not confirmed a payment yet. If you already paid (a bank transfer can take a few minutes), check again shortly." },
    failed: { icon: <XCircle className="h-16 w-16 text-red-500" />, title: "The payment did not go through", body: "You have not been charged for this attempt. You can try again from your order history." },
    mismatch: { icon: <AlertTriangle className="h-16 w-16 text-amber-500" />, title: "We need to look at this payment", body: "The amount Paystack reports does not match this order, so we did not mark it as paid. Please contact the shop with your order number." },
    error: { icon: <AlertTriangle className="h-16 w-16 text-amber-500" />, title: "We could not check this payment", body: message ?? "Please try again." },
  }[outcome];

  return (
    <main className="min-h-[calc(100dvh-125px)] py-10 bg-[#ebedf0] flex flex-col">
      <div className="flex-1 flex flex-col max-w-frame mx-auto px-4 xl:px-0">
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 sm:p-8 rounded-2xl border border-black/10 shadow-md bg-white">
          <div className="mb-4">{view.icon}</div>
          <h2 className={cn(satoshi.className, "text-2xl md:text-3xl font-bold text-black mb-4")}>
            <T>{view.title}</T>
          </h2>
          <p className="mb-8 max-w-md text-black/70">
            <T>{view.body}</T>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {(outcome === "pending" || outcome === "error") && (
              <Button type="button" variant="outline" className="rounded-full" onClick={() => void check()}>
                <T>Check again</T>
              </Button>
            )}
            <Link href="/client/orders">
              <Button className="rounded-full bg-black text-white">
                <T>View order history</T>
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
