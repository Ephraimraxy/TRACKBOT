"use client";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import ProductCard from "@/components/common/ProductCard";
import { ProductFromAPI } from "@/lib/types/product.types";
import { fetchPaginatedDataFromAPI } from "@/lib/utils/fetchData";
import Image from "next/image";

type Category = {
  id: string;
  nom: string;
  description: string | null;
};

const ProductsSec = () => {
  const { t } = useI18n();
  const hasFetched = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [shopProducts, setShopProducts] = useState<ProductFromAPI[] | null>(
    null
  );
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    const fetchProducts = async () => {
      try {
        const shopRes = await fetchPaginatedDataFromAPI<ProductFromAPI[]>(
          "/api/products?sortBy=noteMoyenne&sortOrder=desc&page=1&pageSize=12"
        );

        if (shopRes.error || !shopRes.data?.data) {
          console.error("Could not load homepage products:", shopRes.error);
          setHasError(true);
        } else {
          setShopProducts(shopRes.data.data);
        }
      } catch (error) {
        console.error("Could not load homepage products:", error);
        setHasError(true);
      } finally {
        setIsLoading(false);
      }
    };

    const fetchCategories = async () => {
      try {
        const categoryResponse = await fetch("/api/metadata/categories");
        if (!categoryResponse.ok) {
          throw new Error(`Category request failed (${categoryResponse.status})`);
        }
        const categoryPayload: { data?: Category[] } = await categoryResponse.json();
        if (Array.isArray(categoryPayload.data)) setCategories(categoryPayload.data);
      } catch (error) {
        console.error("Could not load homepage categories:", error);
      }
    };

    void fetchProducts();
    void fetchCategories();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center py-20 gap-4 text-gray-700">
        <div className="w-8 h-8 border-4 border-t-transparent border-blue-500 rounded-full animate-spin"></div>
        <p className="text-lg font-medium"><T>Loading products...</T></p>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center py-20 gap-4 text-[#f74951]">
        {/* Error icon: Circle with an X mark */}
        <Image
          src="/icons/error.png"
          alt={t("Error Icon")}
          width={50}
          height={50}
          className="h-15 w-15"
        />
        <p className="text-lg font-semibold text-center my-5">
          <T>An error occurred while loading products.</T>
          <br />
          <T>Please try again later.</T>
        </p>

        <button
          onClick={() => window.location.reload()}
          className="mt-2 px-4 py-2 text-sm font-medium bg-red-500 text-white rounded hover:bg-red-600 transition"
        >
          <T>Try again</T>
        </button>
      </div>
    );
  }

  return (
    <section className="bg-white py-12 sm:py-16">
      <div className="max-w-frame mx-auto px-4">
        {categories.length > 0 && (
          <div className="mb-12">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
                  <T>Find your style</T>
                </p>
                <h2 className="text-2xl font-bold sm:text-3xl"><T>Shop by category</T></h2>
              </div>
              <Link href="/catalog" className="hidden items-center gap-1 text-sm font-semibold text-black/65 hover:text-black sm:inline-flex">
                <T>All categories</T><ArrowRight size={16} />
              </Link>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {categories.map((category, index) => (
                <Link
                  key={category.id}
                  href={`/catalog?category=${encodeURIComponent(category.nom)}`}
                  className={`group flex min-w-[150px] flex-1 items-end overflow-hidden rounded-2xl border border-black/5 p-4 transition hover:-translate-y-1 hover:shadow-lg ${
                    index % 4 === 0
                      ? "bg-[#f4ece5]"
                      : index % 4 === 1
                        ? "bg-[#eaf0ed]"
                        : index % 4 === 2
                          ? "bg-[#f1edf4]"
                          : "bg-[#f3f0e5]"
                  }`}
                >
                  <span className="text-sm font-semibold text-black transition group-hover:translate-x-1">
                    <T>{category.nom}</T><ArrowRight size={14} className="ml-2 inline-block" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
              <T>Picked for you</T>
            </p>
            <h2 className="text-2xl font-bold sm:text-3xl"><T>Explore our products</T></h2>
            <p className="mt-2 text-sm text-black/55"><T>Find your next favorite from our shop and marketplace.</T></p>
          </div>
          <Link href="/catalog" className="hidden items-center gap-2 rounded-full border border-black/10 px-5 py-3 text-sm font-semibold transition hover:bg-black hover:text-white sm:inline-flex">
            <T>View all products</T><ArrowRight size={16} />
          </Link>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="animate-pulse">
                <div className="aspect-square rounded-2xl bg-[#f0eeed]" />
                <div className="mt-3 h-4 w-3/4 rounded bg-[#f0eeed]" />
                <div className="mt-2 h-4 w-1/3 rounded bg-[#f0eeed]" />
              </div>
            ))}
          </div>
        ) : hasError ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 py-12 text-center text-[#f74951]">
            <Image
              src="/icons/error.png"
              alt={t("Error Icon")}
              width={50}
              height={50}
              className="h-15 w-15"
            />
            <p className="text-base font-semibold">
              <T>An error occurred while loading products.</T>
              <br />
              <T>Please try again later.</T>
            </p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-full bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-black/75"
            >
              <T>Try again</T>
            </button>
          </div>
        ) : shopProducts?.length ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 lg:gap-y-10">
            {shopProducts.map((product) => (
              <ProductCard key={product.id} data={product} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-[#f7f5f2] px-6 py-14 text-center">
            <p className="font-semibold"><T>No products found</T></p>
            <p className="mt-2 text-sm text-black/55"><T>Check back soon for new products.</T></p>
          </div>
        )}

        <Link
          href="/catalog"
          className="mx-auto mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full border border-black/10 px-5 py-3 text-sm font-semibold transition hover:bg-black hover:text-white sm:hidden"
        >
          <T>View all products</T><ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
};

export default ProductsSec;
