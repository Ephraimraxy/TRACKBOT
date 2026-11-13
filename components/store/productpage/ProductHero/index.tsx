"use client";

import { T } from "@/components/i18n/T";

// UI Components
import Rating from "@/components/ui/Rating";

// Components
import PhotoSection from "./PhotoSection";
import ColorSelection from "./ColorSelection";
import SizeSelection from "./SizeSelection";
import AddToCardSection from "./AddToCardSection";

// Utils & Types
import { cn } from "@/lib/utils";
import { ProductFromAPI } from "@/lib/types/product.types";

// Styles
import { integralCF } from "@/styles/fonts";
import { useEffect, useState } from "react";
import { useAppDispatch } from "@/redux/hooks";
import { setColorSelection, setSizeSelection } from "@/redux/features/products/productsSlice";
import { Flag, X, Store } from "lucide-react";
import Link from "next/link";
import { getImageUrlFromPublicId } from "@/lib/utils";
import Image from "@/components/common/SafeImage";
import MDEditor from "@uiw/react-md-editor";

const ProductHero = ({ product }: { product: ProductFromAPI }) => {
  const [showVendorInfo, setShowVendorInfo] = useState(false);
  const dispatch = useAppDispatch();

  // When a product has exactly one colour or one size there is nothing to choose, so pick it for the customer.
  useEffect(() => {
    if (product.couleurs.length === 1) dispatch(setColorSelection(product.couleurs[0]));
    if (product.tailles.length === 1) dispatch(setSizeSelection(product.tailles[0]));
  }, [product, dispatch]);

  return (
    <section className="mb-11">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <PhotoSection data={product} />
        </div>
        <div className="relative">
          <h1
            className={cn([
              integralCF.className,
              "text-2xl md:text-[40px] md:leading-[40px] mb-3 md:mb-3.5 capitalize",
            ])}
          >
            {product.nom}
          </h1>

          <div className="flex items-center mb-3 sm:mb-3.5">
            <Rating
              initialValue={product.noteMoyenne}
              allowFraction
              SVGclassName="inline-block"
              emptyClassName="fill-gray-50"
              size={25}
              readonly
            />
            <span className="text-black text-xs sm:text-sm ml-[11px] sm:ml-[13px] pb-0.5 sm:pb-0">
              {product.noteMoyenne.toFixed(1)}
              <span className="text-black/60">/5</span>
            </span>
            <span className="text-black text-xs xl:text-sm ml-[11px] xl:ml-[13px] pb-0.5 xl:pb-0">
              {`(${product.totalEvaluations} reviews)`}
            </span>
          </div>

          <span className="font-bold text-black text-2xl sm:text-[32px]">
            ₦{product.prix}
          </span>

          <p className="text-sm sm:text-base text-black/60 mb-5">
            {product.objet}
          </p>

          <div className="flex items-center justify-between mb-4">
            {/* Profile Vendeur */}
            <div className="flex items-center relative group">
              <Store className="w-4 h- mr-2 text-gray-600" />
              {product.type === "boutique" ? (
                <>
                  <div className="text-xs xl:text-sm bg-[#F0EEED] text-black font-medium px-2.5 py-1 rounded-full">
                    <T>Official product</T>
                  </div>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-black text-white text-xs rounded px-2 py-1 z-10 w-max max-w-[200px] text-center">
                    <T>Sold and shipped directly by our shop.</T>
                  </div>
                </>
              ) : (
                <button
                  onClick={() => setShowVendorInfo(!showVendorInfo)}
                  className="text-xs xl:text-sm bg-[#F0EEED] text-gray-700 font-medium px-2.5 py-1 rounded-full hover:bg-gray-200"
                >
                  <T>Sold by:</T> {product.vendeur!.nomBoutique}
                </button>
              )}
            </div>

            {/* Report */}
            <Link
              href={`/product/${product.id}/report`}
              className="flex items-center text-sm text-red-500 hover:text-red-700"
            >
              <Flag className="w-4 h-4 mr-1" />
              <T>Report this product</T>
            </Link>
          </div>

          <hr className="h-[1px] border-t-black/10 mb-5" />

          {product.couleurs.length > 0 && (
            <>
              <ColorSelection colors={product.couleurs} />
              <hr className="h-[1px] border-t-black/10 my-5" />
            </>
          )}

          {product.tailles.length > 0 && <SizeSelection sizes={product.tailles} />}
          <hr className="hidden md:block h-[1px] border-t-black/10 my-5" />
          <AddToCardSection data={product} />

          {/* Carte d'information du vendeur */}
          {showVendorInfo && product.vendeur && (
            <div className="absolute top-0 right-0 bg-white p-5 shadow-lg rounded-md border border-gray-200 w-72 xs:w-[350px] sm:w-[500px] md:w-[550px] lg:w-[600px] z-10">
              <button
                className="float-right"
                onClick={() => setShowVendorInfo(false)}
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>

              <div className="flex items-center mb-4">
                <Image
                  width={100}
                  height={100}
                  src={
                    product.vendeur.imagePublicId
                      ? getImageUrlFromPublicId(product.vendeur.imagePublicId)
                      : "/icons/user.svg"
                  }
                  alt={product.vendeur.nomBoutique}
                  className="w-16 h-16 rounded-full object-cover mr-3"
                />
                <div>
                  <h3 className="font-semibold text-2xl">
                    {product.vendeur.nomBoutique}
                  </h3>
                </div>
              </div>

              {product.vendeur.description && (
                <div className="prose-lg" data-color-mode="light">
                  <MDEditor.Markdown source={product.vendeur.description} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default ProductHero;
