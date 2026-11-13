"use client";

import { useState, useEffect } from "react";
import {
  BarChart2,
  Wallet,
  Boxes,
  Users,
  Package,
  TrendingUp,
  Trophy,
} from "lucide-react";

// Components
import StatsCard from "@/components/portal/admin/dashboard/StatsCard";
import ProductRatingCard from "@/components/portal/admin/dashboard/ProductRatingCard";
import DashboardChart from "@/components/portal/admin/dashboard/DashboardChart";
import LoadingState from "@/components/portal/admin/dashboard/LoadingState";
import ErrorState from "@/components/portal/admin/dashboard/ErrorState";

// Types
import { AdminDashboardStats } from "@/lib/types/dashboard.types";

// Fonts
import { montserrat } from "@/styles/fonts";

/** Shown until a product has been rated, instead of a card with made-up numbers. */
function EmptyRatingCard({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-2 text-gray-400">No rated products yet</p>
    </div>
  );
}

export default function DashboardPage() {
  const [dashboardData, setDashboardData] = useState<AdminDashboardStats>({
    totalVentes: "0",
    totalProduits: 0,
    utilisateurs: {
      clients: 0,
      vendeurs: 0,
    },
    produitsVendus: 0,
    meilleurProduit: null,
    pireProduit: null,
    produitPlusRevenu: null,
    produitPlusVendu: null,
    weekData: [],
    monthData: [],
    yearData: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<
    "week" | "month" | "year"
  >("week");

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/analytics/admin");
        if (!response.ok) {
          throw new Error("Failed to fetch dashboard data");
        }
        const data = await response.json();
        setDashboardData(data);
        setLoading(false);
      } catch {
        setError("Error loading dashboard data");
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <ErrorState error={error} onRetry={() => window.location.reload()} />
    );
  }

  const chartData =
    selectedPeriod === "week"
      ? dashboardData.weekData
      : selectedPeriod === "month"
      ? dashboardData.monthData
      : dashboardData.yearData;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-200 py-6 px-4 sm:px-6 lg:px-10">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <BarChart2 className="h-6 w-6 sm:h-8 sm:w-8 text-black animate-pulse" />
          <h1
            className={`text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight ${montserrat.className}`}
            style={{ fontFamily: "'Montserrat', sans-serif" }}
          >
            Dashboard
          </h1>
        </div>

        <div className="mb-8">
          <p
            className={`welcome-message text-base sm:text-lg text-gray-700 ${montserrat.className}`}
            style={{ fontFamily: "'Montserrat', sans-serif" }}
          >
            Welcome, Admin! Here are your shop&apos;s statistics.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-8 sm:mb-10">
          <StatsCard
            icon={Wallet}
            title="Total sales"
            value={`₦${parseInt(
              dashboardData.totalVentes
            ).toLocaleString()}`}
            color="emerald"
          />
          <StatsCard
            icon={Boxes}
            title="Total products"
            value={`${dashboardData.totalProduits} products`}
            color="indigo"
          />
          <StatsCard
            icon={Users}
            title="Users"
            value={`${
              dashboardData.utilisateurs.clients +
              dashboardData.utilisateurs.vendeurs
            } users`}
            subtitle={`${dashboardData.utilisateurs.clients} customers, ${dashboardData.utilisateurs.vendeurs} vendors`}
            color="violet"
          />
          <StatsCard
            icon={Package}
            title="Products sold"
            value={`${dashboardData.produitsVendus} items sold`}
            color="cyan"
          />
          <StatsCard
            icon={Trophy}
            title="Best-selling product"
            value={dashboardData.produitPlusVendu?.nom || "No products sold"}
            subtitle={
              dashboardData.produitPlusVendu
                ? `${dashboardData.produitPlusVendu.quantiteVendue} units sold`
                : "No sales recorded yet"
            }
            color="amber"
          />
          <StatsCard
            icon={TrendingUp}
            title="Highest-revenue product"
            value={dashboardData.produitPlusRevenu?.nom || "No revenue"}
            subtitle={
              dashboardData.produitPlusRevenu
                ? `₦${dashboardData.produitPlusRevenu.totalRevenu.toLocaleString()} in revenue`
                : "No revenue recorded yet"
            }
            color="teal"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-8 sm:mb-10">
          {dashboardData.meilleurProduit ? (
            <ProductRatingCard
              title="Best-rated product"
              productName={dashboardData.meilleurProduit.nom}
              rating={dashboardData.meilleurProduit.noteMoyenne}
              totalEvaluations={dashboardData.meilleurProduit.totalEvaluations}
              color="violet"
            />
          ) : (
            <EmptyRatingCard title="Best-rated product" />
          )}
          {dashboardData.pireProduit ? (
            <ProductRatingCard
              title="Worst-rated product"
              productName={dashboardData.pireProduit.nom}
              rating={dashboardData.pireProduit.noteMoyenne}
              totalEvaluations={dashboardData.pireProduit.totalEvaluations}
              color="rose"
            />
          ) : (
            <EmptyRatingCard title="Worst-rated product" />
          )}
        </div>

        <DashboardChart
          data={chartData}
          period={selectedPeriod}
          onPeriodChange={setSelectedPeriod}
        />
      </div>

      <style jsx>{`
        @keyframes bounce {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }
        .group:hover .animate-bounce {
          animation: bounce 1s infinite ease-in-out;
        }
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }
        .animate-pulse {
          animation: pulse 2s infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-bounce,
          .animate-pulse {
            animation: none;
          }
          .data-card {
            transform: none !important;
          }
        }
        select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7' /%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 0.5rem center;
          background-size: 1em;
          padding-right: 2rem;
        }
      `}</style>
    </div>
  );
}
