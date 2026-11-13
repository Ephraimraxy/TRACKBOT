"use client";

import Link from "next/link";
import { ArrowRight, MapPin, MessageCircle, Search, ShoppingBag } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { integralCF } from "@/styles/fonts";
import { BRAND } from "@/lib/config/brand";
import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";
import SafeImage from "@/components/common/SafeImage";
import { ProductFromAPI } from "@/lib/types/product.types";
import { fetchPaginatedDataFromAPI } from "@/lib/utils/fetchData";
import { getImageUrlFromPublicId } from "@/lib/utils";
import { buildHeroSlots } from "@/lib/utils/heroSlots";

/** How long each set of four cards stays before the next set slides in. */
const ROTATE_MS = 5000;
const PAGE_SIZE = 100;

const FEATURES = [
  {
    icon: ShoppingBag,
    title: "Order in minutes",
    text: "Browse the catalogue, add to your cart and check out with a customer account.",
  },
  {
    icon: MapPin,
    title: "Follow your delivery",
    text: "See every status change, and the driver's live position on a map once your order is out for delivery.",
  },
  {
    icon: MessageCircle,
    title: `Ask ${BRAND.assistantName}`,
    text: "Get real prices, stock levels and your own order status from the shop's chat assistant, any time.",
  },
] as const;

const HeroSec = () => {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const [slots, setSlots] = useState<ProductFromAPI[][]>([]);
  const [slotIndex, setSlotIndex] = useState(0);

  // Load the whole catalogue (it comes in pages) and prepare sets that mix every category.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const first = await fetchPaginatedDataFromAPI<ProductFromAPI[]>(`/api/products?page=1&pageSize=${PAGE_SIZE}`);
      if (cancelled) return;
      if (first.error || !first.data?.data) {
        console.error("Could not load homepage hero products:", first.error);
        return;
      }
      let products = first.data.data;
      const pages = Math.min(first.data.pagination?.totalPages ?? 1, 5);
      if (pages > 1) {
        const rest = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) =>
            fetchPaginatedDataFromAPI<ProductFromAPI[]>(`/api/products?page=${i + 2}&pageSize=${PAGE_SIZE}`)
          )
        );
        products = [...products, ...rest.flatMap((r) => r.data?.data ?? [])];
      }
      if (!cancelled) setSlots(buildHeroSlots(products));
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Every few seconds the next set slides in. Stops for people who ask for less motion, and while the tab is hidden.
  useEffect(() => {
    if (slots.length < 2 || reduceMotion) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setSlotIndex((i) => (i + 1) % slots.length);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [slots, reduceMotion]);

  const featuredProducts = useMemo(() => slots[slotIndex] ?? [], [slots, slotIndex]);
  const upcoming = useMemo(() => (slots.length > 1 ? slots[(slotIndex + 1) % slots.length] : []), [slots, slotIndex]);

  return (
    <section className="relative overflow-hidden bg-[#f7f5f2]">
      <div className="pointer-events-none absolute -left-36 top-12 h-80 w-80 rounded-full bg-amber-200/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-rose-200/30 blur-3xl" />
      <div className="max-w-frame mx-auto px-4 grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center py-10 md:py-16 lg:py-20">
        <div className="relative z-10">
          <h2
            className={cn([
              integralCF.className,
              "text-4xl leading-[1.05] sm:text-5xl lg:text-[64px] lg:leading-[1.05] mb-5",
            ])}
          >
            <T>Find your next favorite.</T>
          </h2>
          <p className="text-black/60 text-base lg:text-lg mb-7 max-w-[540px] leading-7">
            <T>Explore great finds from our shop and marketplace, get help from</T>{" "}
            {BRAND.assistantName}, <T>and follow your order all the way to your door.</T>
          </p>
          <form action="/catalog" className="mb-4 flex max-w-[560px] rounded-full border border-black/10 bg-white p-2 shadow-lg shadow-black/5">
            <label htmlFor="homepage-search" className="sr-only">{t("Search products")}</label>
            <Search className="ml-3 h-5 w-5 shrink-0 self-center text-black/40" aria-hidden="true" />
            <input
              id="homepage-search"
              name="query"
              type="search"
              placeholder={t("What are you looking for?")}
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none placeholder:text-black/40"
            />
            <button
              type="submit"
              aria-label={t("Search")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black text-white transition hover:bg-black/75 sm:w-auto sm:px-5"
            >
              <span className="hidden sm:inline"><T>Search</T></span>
              <ArrowRight className="h-4 w-4 sm:ml-2" aria-hidden="true" />
            </button>
          </form>
          <Link
            href="/catalog"
            className="inline-flex items-center gap-2 px-2 py-2 text-sm font-semibold text-black transition hover:gap-3"
          >
            <T>Browse all products</T><ArrowRight size={16} aria-hidden="true" />
          </Link>

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-black/65">
            <span className="inline-flex items-center gap-2"><ShoppingBag size={17} /><T>Easy online shopping</T></span>
            <span className="inline-flex items-center gap-2"><MapPin size={17} /><T>Live delivery tracking</T></span>
            <span className="inline-flex items-center gap-2"><MessageCircle size={17} /><T>Helpful chat assistant</T></span>
          </div>
        </div>

        <div className="relative mx-auto h-[410px] w-full max-w-[570px] sm:h-[500px]">
          <motion.div
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 h-[290px] w-[290px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-gradient-to-br from-white via-amber-50 to-rose-100 shadow-[0_35px_90px_rgba(74,54,38,0.12)] sm:h-[390px] sm:w-[390px]"
            animate={{ scale: [1, 1.035, 1], rotate: [0, 3, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="absolute left-1/2 top-1/2 h-[230px] w-[230px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 sm:h-[315px] sm:w-[315px]" />

          {/* The next set's photos, loaded out of sight, so the swap shows a finished card */}
          <div aria-hidden="true" className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0">
            {upcoming.map((product) => (
              <SafeImage
                key={product.id}
                src={product.images[0]?.imagePublicId ? getImageUrlFromPublicId(product.images[0].imagePublicId) : "/images/placeholder.png"}
                alt=""
                width={220}
                height={220}
                loading="eager"
              />
            ))}
          </div>

          {featuredProducts.length > 0 ? (
            featuredProducts.map((product, index) => {
              const positions = [
                "left-[2%] top-[8%]",
                "right-[1%] top-[5%]",
                "left-[3%] bottom-[5%]",
                "right-[2%] bottom-[4%]",
              ];
              const rotations = [-7, 6, 5, -5];
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 24, scale: 0.94 }}
                  animate={{ opacity: 1, y: [0, index % 2 === 0 ? -12 : 12, 0], scale: 1 }}
                  transition={{
                    opacity: { duration: 0.5, delay: index * 0.12 },
                    scale: { duration: 0.5, delay: index * 0.12 },
                    y: { duration: 4 + index * 0.5, repeat: Infinity, ease: "easeInOut", delay: index * 0.2 },
                  }}
                  whileHover={{ scale: 1.05, rotate: 0, zIndex: 10 }}
                  className={`absolute ${positions[index]} z-[1] w-[43%] max-w-[205px]`}
                  style={{ rotate: rotations[index] }}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={product.id}
                      initial={{ opacity: 0, y: 18, scale: 0.94 }}
                      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, delay: index * 0.1 } }}
                      exit={{ opacity: 0, y: -14, scale: 0.94, transition: { duration: 0.3 } }}
                    >
                      <Link
                        href={`/product/${product.id}`}
                        className="block overflow-hidden rounded-2xl border border-white/80 bg-white p-2.5 shadow-[0_18px_45px_rgba(33,24,17,0.16)] sm:rounded-3xl sm:p-3"
                      >
                        <div className="aspect-square overflow-hidden rounded-xl bg-[#f3f0ed] sm:rounded-2xl">
                          <SafeImage
                            src={
                              product.images[0]?.imagePublicId
                                ? getImageUrlFromPublicId(product.images[0].imagePublicId)
                                : "/images/placeholder.png"
                            }
                            alt={product.nom}
                            width={220}
                            height={220}
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <div className="px-1 pt-2">
                          {product.categorie?.nom && (
                            <p className="truncate text-[10px] font-medium uppercase tracking-wide text-black/45">
                              <T>{product.categorie.nom}</T>
                            </p>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-semibold text-black sm:text-sm">{product.nom}</p>
                            <p className="shrink-0 text-xs font-bold text-black sm:text-sm">₦{product.prix}</p>
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  </AnimatePresence>
                </motion.div>
              );
            })
          ) : (
            <motion.div
              className="absolute left-1/2 top-1/2 z-[1] flex h-48 w-48 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-3xl border border-white bg-white/80 p-6 text-center shadow-xl"
              animate={{ y: [0, -10, 0], rotate: [0, 2, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            >
              <div>
                <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-black/70" />
                <p className="font-semibold"><T>Good finds are waiting</T></p>
                <p className="mt-1 text-xs text-black/55"><T>Browse the latest products in our shop.</T></p>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <div className="relative border-t border-black/5 bg-white/65">
        <ul className="max-w-frame mx-auto grid grid-cols-1 gap-4 px-4 py-5 sm:grid-cols-3 sm:gap-6">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f1eeea] text-black">
                <Icon size={19} aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm font-bold"><T>{title}</T></h3>
                <p className="text-xs leading-5 text-black/55"><T>{text}</T></p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default HeroSec;
