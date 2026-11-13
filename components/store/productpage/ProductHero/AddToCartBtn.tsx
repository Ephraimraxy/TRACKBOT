"use client";

import { T } from "@/components/i18n/T";

// Redux
import { RootState } from "@/redux/store";
import { addToCart } from "@/redux/features/carts/cartsSlice";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";

// Types
import { ProductFromAPI } from "@/lib/types/product.types";
import { cn } from "@/lib/utils";

const AddToCartBtn = ({
  data,
}: {
  data: ProductFromAPI & { quantity: number };
}) => {
  const dispatch = useAppDispatch();
  const { sizeSelection, colorSelection } = useAppSelector(
    (state: RootState) => state.products
  );

  // A product with no colours (or no sizes) has nothing to pick, so it must not be required.
  const needsColor = (data.couleurs?.length ?? 0) > 0;
  const needsSize = (data.tailles?.length ?? 0) > 0;
  const canAdd =
    (!needsColor || !!colorSelection.id) && (!needsSize || !!sizeSelection.id) && data.quantity > 0;

  return (
    <button
      type="button"
      className={cn(
        "bg-black w-full ml-3 sm:ml-5 rounded-full h-11 md:h-[52px] text-sm sm:text-base text-white transition-all",
        {
          "hover:bg-black/80 cursor-pointer": canAdd,
          "bg-gray-400 cursor-not-allowed opacity-60": !canAdd,
        }
      )}
      disabled={!canAdd}
      onClick={() =>
        dispatch(
          addToCart({
            id: data.id,
            name: data.nom,
            imagePublicId: data.images[0].imagePublicId,
            price: data.prix,
            color: {
              id: colorSelection.id,
              name: colorSelection.nom,
            },
            size: {
              id: sizeSelection.id,
              name: sizeSelection.nom,
            },
            quantity: data.quantity,
          })
        )
      }
    >
      <T>Add to cart</T>
    </button>
  );
};

export default AddToCartBtn;
