"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Issue = {
  id: string; kind: "AMOUNT_MISMATCH" | "DOUBLE_PAYMENT" | "DISPUTE" | "REFUND"; status: "OPEN" | "RESOLVED"; orderRef: string; orderId: string; reference: string;
  amountPaidKobo: number | null; expectedKobo: number | null; note: string; customer: string | null; customerEmail: string | null; createdAt: string; resolvedAt: string | null; resolutionNote: string | null;
};

const KIND: Record<Issue["kind"], string> = { AMOUNT_MISMATCH: "Wrong amount", DOUBLE_PAYMENT: "Paid twice", DISPUTE: "Dispute", REFUND: "Refund" };
const naira = (k: number | null) => (k == null ? "–" : `₦${(k / 100).toLocaleString("en-NG")}`);

export default function PaymentIssuesPage() {
  const [show, setShow] = useState<"open" | "resolved">("open");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/payment-issues?status=${show}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Could not load payment issues.");
      setIssues(json.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [show]);

  useEffect(() => {
    setIssues(null);
    load();
  }, [load]);

  const resolve = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/payment-issues/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: notes[id] ?? "" }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Could not resolve.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const reconcile = async () => {
    setChecking(true);
    setChecked(null);
    try {
      const res = await fetch("/api/admin/payments/reconcile", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Could not check with Paystack.");
      const d = json.data as { checked: number; markedPaid: number; stillWaiting: number; failed: number; needsReview: number; couldNotCheck: number };
      setChecked(d.checked === 0 ? "No waiting payments to check." : `Checked ${d.checked}: ${d.markedPaid} marked paid, ${d.stillWaiting} still waiting, ${d.failed} failed, ${d.needsReview} need review${d.couldNotCheck ? `, ${d.couldNotCheck} could not be checked` : ""}.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-4" data-testid="payment-issues">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Payments to look at</h1>
        <select value={show} onChange={(e) => setShow(e.target.value as "open" | "resolved")} className="rounded border px-2 py-1 text-sm" aria-label="Show">
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <Link href="/admin/deliveries" className="ml-auto text-sm text-blue-700 underline">Deliveries</Link>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={reconcile} disabled={checking} className="rounded border border-blue-600 px-3 py-1 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-40" data-testid="reconcile">
          {checking ? "Checking…" : "Check waiting payments with Paystack"}
        </button>
        {checked && <span className="text-sm text-gray-700" data-testid="reconcile-result">{checked}</span>}
      </div>
      <p className="mb-3 text-sm text-gray-600">An order is only marked paid when Paystack reports exactly the order total in naira. Anything else, a second payment, or a dispute shows here. Refunds and dispute answers are done in the Paystack dashboard; mark an item resolved when you have dealt with it.</p>
      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!issues && !error && <div className="h-32 animate-pulse rounded border bg-gray-100" />}
      {issues && issues.length === 0 && <p className="rounded border border-dashed p-4 text-sm text-gray-600">{show === "open" ? "Nothing to look at. Every payment matched its order." : "No resolved items yet."}</p>}
      <ul className="space-y-3">
        {issues?.map((i) => (
          <li key={i.id} className="rounded-lg border bg-white p-4 text-sm" data-testid="payment-issue">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${i.status === "OPEN" ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-900"}`}>{KIND[i.kind]}</span>
              <span className="font-mono text-xs">order #{i.orderRef}</span>
              <span className="text-gray-600">{i.customer}{i.customerEmail ? ` · ${i.customerEmail}` : ""}</span>
              <span className="ml-auto text-xs text-gray-500">{new Date(i.createdAt).toLocaleString("en-NG")}</span>
            </div>
            <p className="mt-2">{i.note}</p>
            <p className="mt-1 text-xs text-gray-600">Paid {naira(i.amountPaidKobo)} · order total {naira(i.expectedKobo)} · Paystack reference <span className="font-mono">{i.reference}</span></p>
            {i.status === "OPEN" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <input value={notes[i.id] ?? ""} onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })} placeholder="What you did (optional)" maxLength={500} className="min-w-[12rem] flex-1 rounded border px-2 py-1" />
                <button type="button" disabled={busy === i.id} onClick={() => resolve(i.id)} className="rounded bg-green-600 px-3 py-1 text-white disabled:opacity-40">Mark resolved</button>
              </div>
            ) : (
              i.resolutionNote && <p className="mt-2 text-xs text-gray-600">Resolved: {i.resolutionNote}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
