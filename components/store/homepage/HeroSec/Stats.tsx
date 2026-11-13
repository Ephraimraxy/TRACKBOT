"use client";

import { useEffect, useState } from "react";

import { Separator } from "@/components/ui/separator";
import AnimatedCounter from "@/components/ui/AnimatedCounter";
import { T } from "@/components/i18n/T";

type Totals = { totalProducts: number; totalUsers: number };

/** Live counts from the database. Nothing is shown until the real numbers arrive. */
const Stats = () => {
  const [totals, setTotals] = useState<Totals | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/metadata/stats");
        if (!res.ok) return;
        const { data } = await res.json();
        if (!cancelled) setTotals({ totalProducts: data.totalProducts, totalUsers: data.totalUsers });
      } catch {
        // No numbers is better than wrong numbers.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!totals) return null;

  return (
    <div className="flex items-center gap-6">
      <div className="flex flex-col">
        <span className="font-bold text-3xl lg:text-[40px]">
          <AnimatedCounter from={0} to={totals.totalProducts} />
        </span>
        <span className="text-xs lg:text-base text-black/60"><T>Products</T></span>
      </div>
      <Separator className="h-12 bg-black/10" orientation="vertical" />
      <div className="flex flex-col">
        <span className="font-bold text-3xl lg:text-[40px]">
          <AnimatedCounter from={0} to={totals.totalUsers} />
        </span>
        <span className="text-xs lg:text-base text-black/60"><T>Registered users</T></span>
      </div>
    </div>
  );
};

export default Stats;
