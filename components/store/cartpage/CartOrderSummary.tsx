"use client";

import { T } from "@/components/i18n/T";

import React from "react";
import Link from "next/link";
import { FaArrowRight } from "react-icons/fa6";
import { ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { satoshi } from "@/styles/fonts";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/redux/hooks";
import { RootState } from "@/redux/store";

export default function CartOrderSummary() {
  const { cart, totalPrice } = useAppSelector(
    (state: RootState) => state.carts
  );

  return (
    <div className="w-full lg:max-w-[505px] p-6 sm:p-8 rounded-2xl border border-black/10 shadow-md bg-white">
      <h3
        className={cn(
          satoshi.className,
          "text-xl md:text-2xl font-bold text-black mb-6 flex items-center gap-3"
        )}
      >
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gray-100">
          <ShoppingBag className="h-5 w-5 text-gray-700" />
        </div>
        <T>Order summary</T>
      </h3>

      <div className="flex flex-col space-y-4">
        {cart?.items.map((item, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between text-black py-2"
          >
            <span className="text-sm md:text-base text-gray-700 truncate max-w-[60%] flex flex-col">
              <span className={cn(satoshi.className, "")}>
                {item.quantity} × {item.name}
              </span>
              <span className={cn(satoshi.className, "ml-[25px]")}>
                {item.color.name && <><T>Colour:</T> {item.color.name}</>}
                {item.color.name && item.size.name && ", "}
                {item.size.name && <><T>Size:</T> {item.size.name}</>}
              </span>
            </span>

            <span
              className={cn(
                satoshi.className,
                "text-sm md:text-base font-medium"
              )}
            >
              ₦{item.quantity * item.price}
            </span>
          </div>
        ))}

        <hr className="border-t border-gray-200 my-2" />

        <div className="flex items-center justify-between py-2">
          <span
            className={cn(
              satoshi.className,
              "md:text-xl text-gray-800 font-medium"
            )}
          >
            <T>Total</T>
          </span>
          <span
            className={cn(
              satoshi.className,
              "text-xl md:text-2xl font-bold text-black"
            )}
          >
            ₦{totalPrice}
          </span>
        </div>
      </div>

      <Button
        type="button"
        className={cn(
          satoshi.className,
          "mt-6 text-sm md:text-base font-medium bg-gradient-to-r from-gray-800 to-black rounded-full w-full py-4 h-[54px] md:h-[60px] text-white group hover:from-gray-900 hover:to-black transition-all shadow-lg hover:shadow-xl"
        )}
        asChild
      >
        <Link href="/order">
          <T>Place order</T>
          <FaArrowRight className="text-xl ml-2 group-hover:translate-x-1 transition-all duration-200" />
        </Link>
      </Button>
    </div>
  );
}
