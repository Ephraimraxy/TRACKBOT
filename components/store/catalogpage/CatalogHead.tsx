"use client";

import { FiShoppingCart } from "react-icons/fi";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MobileFilters from "@/components/store/catalogpage/filters/MobileFilters";
import { montserrat } from "@/styles/fonts";
import { T } from "@/components/i18n/T";

interface CatalogHeaderProps {
  totalItems: number;
  currentPage: number;
  pageSize: number;
  onSortChange: (value: string) => void;
  selectedGender: string | null;
  selectedCategory: string | null;
  priceRange: [number, number];
  selectedColor: string | null;
  selectedSize: string | null;
  onApplyFilters: (filters: {
    gender: string | null;
    category: string | null;
    priceRange: [number, number];
    color: string | null;
    size: string | null;
  }) => void;
  onResetFilters: () => void;
}

export default function CatalogHead({
  totalItems,
  currentPage,
  pageSize,
  onSortChange,
  selectedGender,
  selectedCategory,
  priceRange,
  selectedColor,
  selectedSize,
  onApplyFilters,
  onResetFilters,
}: CatalogHeaderProps) {
  const startIndex = (currentPage - 1) * pageSize + 1;
  const endIndex = Math.min(currentPage * pageSize, totalItems);

  return (
    <>
      <div className="mb-4 flex flex-col">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h1
              className={`text-2xl md:text-[32px] font-extrabold uppercase tracking-tight ${montserrat.className}`}
            >
              <T>Our products</T>
            </h1>
            <FiShoppingCart className="text-black text-2xl md:text-3xl" />
          </div>
          <MobileFilters
            selectedGender={selectedGender}
            selectedCategory={selectedCategory}
            priceRange={priceRange}
            selectedColor={selectedColor}
            selectedSize={selectedSize}
            onApplyFilters={onApplyFilters}
            onResetFilters={onResetFilters}
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
          <span className="text-sm md:text-base text-black/60">
            <T>Showing</T> {startIndex} <T>to</T> {endIndex} <T>of</T> {totalItems} <T>products</T>
          </span>
          <div className="flex items-center">
            <T>Sort by:</T>{" "}
            <Select defaultValue="most-popular" onValueChange={onSortChange}>
              <SelectTrigger className="font-medium text-sm px-1.5 sm:text-base w-fit text-black bg-transparent shadow-none border-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="most-popular"><T>Most popular</T></SelectItem>
                <SelectItem value="low-price"><T>Low price</T></SelectItem>
                <SelectItem value="high-price"><T>High price</T></SelectItem>
                <SelectItem value="newest"><T>Newest</T></SelectItem>
                <SelectItem value="oldest"><T>Oldest</T></SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </>
  );
}
