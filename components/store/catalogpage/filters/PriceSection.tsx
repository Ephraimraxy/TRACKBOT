"use client";

import { T } from "@/components/i18n/T";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Slider } from "@/components/ui/slider";
import { PRICE_MAX } from "@/lib/constants/catalog";

interface PriceSectionProps {
  value: [number, number];
  onChange: (range: [number, number]) => void;
}

export default function PriceSection({ value, onChange }: PriceSectionProps) {
  return (
    <Accordion type="single" collapsible defaultValue="filter-price">
      <AccordionItem value="filter-price" className="border-none">
        <AccordionTrigger className="text-black font-bold text-xl hover:no-underline p-0 py-0.5">
          <T>Price (₦)</T>
        </AccordionTrigger>
        <AccordionContent className="pt-4 px-2 overflow-visible">
          <Slider
            value={value}
            onValueChange={onChange}
            min={0}
            max={PRICE_MAX}
            step={1000}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
