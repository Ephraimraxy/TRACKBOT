import type { Metadata } from "next";

import { BRAND, CREDIT } from "@/lib/config/brand";
import { T } from "@/components/i18n/T";

export const metadata: Metadata = { title: "About this project" };

export default function AboutPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-2"><T>About</T> {BRAND.name}</h1>
      <p className="text-black/60 mb-8">{BRAND.projectTitle}</p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-2"><T>The problem</T></h2>
        <p className="text-black/80">
          <T>Many small online businesses answer every customer message by hand and have no way to show
          customers where an order is.</T> {BRAND.name} <T>joins the two: a chat assistant that answers from
          the shop&apos;s real data, and an order tracking system covering the owner, the customer
          and the delivery person.</T>
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-2"><T>What it does</T></h2>
        <ul className="list-disc pl-5 space-y-1 text-black/80">
          <li><T>Customers browse, order, and follow each status change of their order.</T></li>
          <li><T>Delivery staff update deliveries, and can share their position while an order is out for delivery.</T></li>
          <li><T>The shop owner manages products, orders, drivers and the assistant&apos;s FAQ answers.</T></li>
          <li>
            <T>The assistant (</T>{BRAND.assistantName}<T>) reads real prices, stock and the customer&apos;s own
            order status, and says so when it does not know.</T>
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-2"><T>Project team</T></h2>
        <p className="text-black/80">
          {BRAND.degree} <T>final-year project,</T> {BRAND.institution}, {BRAND.year}.
        </p>
        <ul className="mt-2 space-y-1">
          {BRAND.team.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-black/60"><T>Supervisor:</T> {BRAND.supervisor}</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2"><T>Credit</T></h2>
        <div className="space-y-1 text-sm">
          <p className="font-medium">{CREDIT.name}</p>
          <p>{CREDIT.role}</p>
          <p>
            <a href={CREDIT.websiteUrl} className="underline" target="_blank" rel="noopener noreferrer">
              {CREDIT.website}
            </a>
          </p>
          <p><a href={`tel:${CREDIT.phone}`} className="underline">{CREDIT.phone}</a></p>
        </div>
      </section>
    </main>
  );
}
