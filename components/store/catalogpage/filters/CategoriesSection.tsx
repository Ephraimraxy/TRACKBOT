"use client";

import { T } from "@/components/i18n/T";
import { useEffect, useState } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MdKeyboardArrowRight } from "react-icons/md";

type Category = {
  nom: string;
  description: string | null;
};

// Shown until the real list arrives from the shop (or if it cannot be loaded).
const fallbackCategories: Category[] = [
  {
    nom: "Tops",
    description:
      "T-shirts, shirts, sweaters and other upper-body clothing.",
  },
  {
    nom: "Bottoms",
    description:
      "Trousers, jeans, shorts and other lower-body clothing.",
  },
  {
    nom: "Dresses & Sets",
    description: "Dresses and matching sets for all occasions.",
  },
  {
    nom: "Jackets & Coats",
    description: "Light jackets, winter coats and bomber jackets.",
  },
  {
    nom: "Footwear",
    description: "Sneakers, boots, sandals and other types of footwear.",
  },
  {
    nom: "Accessories",
    description: "Bags, scarves, belts and other accessories.",
  },
  {
    nom: "Other",
    description: "Miscellaneous items that do not fit in other categories.",
  },
];

interface CategoriesSectionProps {
  selectedNom: string | null;
  onSelect: (nom: string | null) => void;
}

export default function CategoriesSection({
  selectedNom,
  onSelect,
}: CategoriesSectionProps) {
  const [categoriesData, setCategories] = useState<Category[]>(fallbackCategories);

  // The categories come from the shop itself, so a category the owner adds appears here too.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/metadata/categories");
        if (!res.ok) return;
        const { data } = await res.json();
        if (!cancelled && Array.isArray(data) && data.length > 0) setCategories(data);
      } catch {
        // Keep the fallback list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = (nom: string) => {
    onSelect(selectedNom === nom ? null : nom); // Toggle selection
  };

  return (
    <Accordion type="single" collapsible defaultValue="filter-categories">
      <AccordionItem value="filter-categories" className="border-none">
        <AccordionTrigger className="text-black font-bold text-xl hover:no-underline p-0 py-0.5">
          <T>Categories</T>
        </AccordionTrigger>
        <AccordionContent className="pt-4 pb-0">
          <div className="flex flex-col space-y-1 text-black/80">
            {categoriesData.map((category) => (
              <div className="relative group" key={category.nom}>
                <button
                  onClick={() => handleSelect(category.nom)}
                  className={`flex items-center justify-between w-full py-2 px-3 rounded-lg transition ${
                    selectedNom === category.nom
                      ? "bg-black text-white"
                      : "hover:bg-black/10"
                  }`}
                >
                  <T>{category.nom}</T> <MdKeyboardArrowRight />
                </button>
                {category.description && (
                  <div className="absolute z-10 hidden group-hover:block w-64 bg-white border border-gray-200 shadow-md text-sm text-gray-700 p-2 rounded-md top-full mt-1 left-0">
                    <T>{category.description}</T>
                  </div>
                )}
              </div>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
