"use client";

import { T } from "@/components/i18n/T";

import { Button } from "@/components/ui/button";
import { GENDERED_CATEGORIES, PRICE_MAX } from "@/lib/constants/catalog";
import CategoriesSection from "@/components/store/catalogpage/filters/CategoriesSection";
import ColorsSection from "@/components/store/catalogpage/filters/ColorsSection";
import PriceSection from "@/components/store/catalogpage/filters/PriceSection";
import SizeSection from "@/components/store/catalogpage/filters/SizeSection";
import GendersSection from "@/components/store/catalogpage/filters/GendersSection";
import ShoesSizeSection from "@/components/store/catalogpage/filters/ShoesSizeSection";

interface FiltersProps {
  localGender: string | null;
  setLocalGender: (value: string | null) => void;
  localCategory: string | null;
  setLocalCategory: (value: string | null) => void;
  localPriceRange: [number, number];
  setLocalPriceRange: (value: [number, number]) => void;
  localColor: string | null;
  setLocalColor: (value: string | null) => void;
  localSize: string | null;
  setLocalSize: (value: string | null) => void;
  onApplyFilters: (filters: {
    gender: string | null;
    category: string | null;
    priceRange: [number, number];
    color: string | null;
    size: string | null;
  }) => void;
  onResetFilters: () => void;
}

export default function Filters({
  localGender,
  setLocalGender,
  localCategory,
  setLocalCategory,
  localPriceRange,
  setLocalPriceRange,
  localColor,
  setLocalColor,
  localSize,
  setLocalSize,
  onApplyFilters,
  onResetFilters,
}: FiltersProps) {
  const handleApplyFilters = (patch: Partial<Parameters<typeof onApplyFilters>[0]> = {}) => {
    onApplyFilters({
      gender: localGender,
      category: localCategory,
      priceRange: localPriceRange,
      color: localColor,
      size: localSize,
      ...patch,
    });
  };

  const handleResetFilters = () => {
    setLocalGender(null);
    setLocalCategory(null);
    setLocalPriceRange([0, PRICE_MAX]);
    setLocalColor(null);
    setLocalSize(null);
    onResetFilters();
  };

  return (
    <>
      <hr className="border-t-black/10" />
      <GendersSection
        selectedNom={localGender}
        onSelect={(gender) => {
          // A gender only makes sense with clothing-type categories, so drop a category that has none.
          const dropCategory = !!gender && !!localCategory && !GENDERED_CATEGORIES.includes(localCategory);
          setLocalGender(gender);
          if (dropCategory) setLocalCategory(null);
          handleApplyFilters({ gender, ...(dropCategory ? { category: null } : {}) });
        }}
      />

      <hr className="border-t-black/10" />
      <CategoriesSection
        selectedNom={localCategory}
        onSelect={(category) => {
          // Electronics, groceries etc. have no gender, so a chosen gender would hide everything.
          const dropGender = !!category && !GENDERED_CATEGORIES.includes(category);
          setLocalCategory(category);
          if (dropGender) setLocalGender(null);
          handleApplyFilters({ category, ...(dropGender ? { gender: null } : {}) });
        }}
      />

      <hr className="border-t-black/10" />
      <PriceSection value={localPriceRange} onChange={setLocalPriceRange} />

      <hr className="border-t-black/10" />
      <ColorsSection
        selectedNom={localColor}
        onSelect={(color) => {
          setLocalColor(color);
          handleApplyFilters({ color });
        }}
      />

      <hr className="border-t-black/10" />
      <SizeSection
        selectedNom={localSize}
        onSelect={(size) => {
          setLocalSize(size);
          handleApplyFilters({ size });
        }}
      />

      <hr className="border-t-black/10" />
      <ShoesSizeSection
        selectedNom={localSize}
        onSelect={(size) => {
          setLocalSize(size);
          handleApplyFilters({ size });
        }}
      />

      <hr className="border-t-black/10" />
      <Button
        type="button"
        className="bg-black w-full rounded-full text-sm font-medium py-4 h-12"
        onClick={() => handleApplyFilters()}
      >
        <T>Apply filters</T>
      </Button>

      <Button
        type="button"
        className="bg-gray-200 text-black w-full rounded-full text-sm font-medium py-4 h-12"
        onClick={handleResetFilters}
      >
        <T>Reset filters</T>
      </Button>
    </>
  );
}
