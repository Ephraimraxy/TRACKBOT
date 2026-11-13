"use client";

import { useState } from "react";

import { T } from "@/components/i18n/T";

type Payment = { statut: string; canal?: string | null } | null | undefined;

const BADGE: Record<string, { label: string; className: string }> = {
  VALIDE: { label: "Paid", className: "bg-green-100 text-green-800" },
  EN_COURS: { label: "Awaiting payment", className: "bg-amber-100 text-amber-800" },
  ECHOUE: { label: "Payment failed", className: "bg-red-100 text-red-800" },
};

const CHANNEL: Record<string, string> = {
  card: "Card",
  bank_transfer: "Bank transfer",
  bank: "Bank",
  ussd: "USSD",
  qr: "QR",
  mobile_money: "Mobile money",
};

/**
 * Whether an order has been paid, with a "Pay now" button for the customer when it has not.
 * `canPay` is true only on the customer's own screens, and never for a cancelled order.
 */
export default function PaymentStatus({ orderId, payment, canPay = false }: { orderId: string; payment: Payment; canPay?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const badge = BADGE[payment?.statut ?? "EN_COURS"] ?? BADGE.EN_COURS;
  const unpaid = payment?.statut !== "VALIDE";

  const payNow = async (e: React.MouseEvent) => {
    e.stopPropagation(); // the row behind this button opens the order details
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.authorizationUrl) throw new Error(json.error ?? "The payment page could not be opened.");
      window.location.href = json.authorizationUrl;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
        <T>{badge.label}</T>
        {!unpaid && payment?.canal && CHANNEL[payment.canal] ? <span className="font-normal"> · <T>{CHANNEL[payment.canal]}</T></span> : null}
      </span>
      {unpaid && canPay && (
        <button
          type="button"
          onClick={payNow}
          disabled={busy}
          className="rounded-full bg-black px-3 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {busy ? "…" : <T>Pay now</T>}
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
