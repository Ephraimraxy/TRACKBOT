"use client";

import { useState, useEffect, useRef } from "react";
import OrderHeader from "@/components/store/orderpage/OrderHeader";
import DeliveryAddressForm from "@/components/store/orderpage/DeliveryAddressForm";
import DeliveryPinPicker, { type Pin } from "@/components/store/orderpage/DeliveryPinPicker";
import PaystackNotice from "@/components/store/orderpage/PaystackNotice";
import OrderSummary from "@/components/store/orderpage/OrderSummary";
import { useSession } from "next-auth/react";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import { clearCart } from "@/redux/features/carts/cartsSlice";
import { RootState } from "@/redux/store";
import { PrepareOrderFromAPI } from "@/lib/types/order.types";
import { ApiResponse } from "@/lib/types/apiResponse.types";
import IsLoading from "@/components/store/cartpage/IsLoading";
import IsOrderSuccessful from "@/components/store/orderpage/IsOrderSuccessful";

export default function OrderPageMain() {
  const { data: session } = useSession();
  const cart = useAppSelector((state: RootState) => state.carts.cart);
  const dispatch = useAppDispatch();

  const [orderSummary, setOrderSummary] = useState<PrepareOrderFromAPI | null>(
    null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{
    [key: string]: string;
  }>({});
  const [isFetchingSummary, setIsFetchingSummary] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Set only when the order was saved but Paystack's payment page could not be opened.
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // True from the moment the order is saved until the browser leaves for Paystack. The cart is emptied in that gap, and
  // the page must not react to the empty cart (it would flash "Your cart is empty").
  const [isRedirecting, setIsRedirecting] = useState(false);
  const redirecting = useRef(false);

  const [pin, setPin] = useState<Pin | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState({
    street: "",
    city: "",
    wilaya: "",
    postalCode: "",
    landmark: "",
  });

  useEffect(() => {
    const fetchOrderSummary = async () => {
      if (redirecting.current) return;
      if (!cart || cart.items.length === 0) {
        setErrorMessage(
          "Your cart is empty. You must add products before placing an order."
        );
        return;
      }

      setIsFetchingSummary(true);
      setErrorMessage(null);

      const payload = {
        produits: cart.items.map((item) => ({
          produitId: item.id,
          quantite: item.quantity,
          couleurId: item.color.id || undefined,
          tailleId: item.size.id || undefined,
        })),
      };

      try {
        const response = await fetch("/api/orders/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const data: ApiResponse<PrepareOrderFromAPI> = await response.json();
          setOrderSummary(data.data);
        } else if (response.status === 400) {
          const errorData: ApiResponse<PrepareOrderFromAPI> =
            await response.json();
          if (
            errorData.error ===
            "Failed to create the product: one or more IDs provided are invalid."
          ) {
            setErrorMessage(
              "An error occurred while preparing the order. Please refresh your cart with recent content. The products provided no longer exist or their identifiers have changed."
            );
          } else {
            setErrorMessage(
              "An error occurred while preparing the order."
            );
          }
        } else {
          setErrorMessage(
            "An error occurred while preparing the order."
          );
        }
      } catch {
        setErrorMessage(
          "An error occurred while preparing the order."
        );
      } finally {
        setIsFetchingSummary(false);
      }
    };

    fetchOrderSummary();
  }, [cart]);

  const handleDeliveryAddressChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setDeliveryAddress({ ...deliveryAddress, [e.target.name]: e.target.value });
  };

  /** Open Paystack's payment page for a saved order. If that fails the order stays in the history, unpaid. */
  const startPayment = async (orderId: string) => {
    try {
      const res = await fetch("/api/payments/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.authorizationUrl) {
        throw new Error(json.error ?? "The payment page could not be opened.");
      }
      window.location.href = json.authorizationUrl;
    } catch (e) {
      setPaymentError((e as Error).message);
    }
  };

  const handleSubmit = async () => {
    if (!orderSummary) return;

    setIsSubmitting(true);
    setValidationErrors({});
    setErrorMessage(null);

    const productsForOrder = orderSummary.produits.map((product) => ({
      produitId: product.produitId,
      quantite: product.quantite,
      couleurId: product.couleur?.id,
      tailleId: product.taille?.id,
    }));

    const payload = {
      userId: session!.user.id,
      addresse: {
        rue: deliveryAddress.street,
        ville: deliveryAddress.city,
        wilaya: deliveryAddress.wilaya,
        codePostal: deliveryAddress.postalCode,
        ...(deliveryAddress.landmark.trim() ? { repere: deliveryAddress.landmark.trim() } : {}),
        ...(pin ? { latitude: pin.latitude, longitude: pin.longitude } : {}),
      },
      produits: productsForOrder,
    };

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const { data: order } = await response.json();
        // The order is saved, so the cart is done with. Then to Paystack to pay for it.
        redirecting.current = true;
        setIsRedirecting(true);
        dispatch(clearCart());
        await startPayment(order.id);
        // startPayment leaves the page on success. If it did not, the error screen below takes over.
      } else if (response.status === 400) {
        const errorData = await response.json();
        if (errorData.data) {
          const errors = errorData.data.reduce(
            (
              acc: { [key: string]: string },
              err: { field: string; message: string }
            ) => {
              acc[err.field] = err.message;
              return acc;
            },
            {}
          );
          setValidationErrors(errors);
          setErrorMessage("Please correct the errors below.");
        } else {
          setErrorMessage(
            errorData.error || "An error occurred while placing the order."
          );
        }
      } else {
        setErrorMessage("An error occurred while placing the order.");
      }
    } catch {
      setErrorMessage("An error occurred while placing the order.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (paymentError) {
    return <IsOrderSuccessful paymentError={paymentError} />;
  }

  // The order is saved and Paystack's payment page is being opened: say so, instead of showing the emptied cart.
  if (isRedirecting) {
    return (
      <main className="min-h-[calc(100dvh-125px)] py-10 bg-white" data-testid="redirecting-to-payment">
        <div className="max-w-frame mx-auto px-4 xl:px-0">
          <OrderHeader />
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-black" />
            <p className="text-lg font-semibold">Your order is saved.</p>
            <p className="text-sm text-gray-600">Opening the secure payment page… please do not close this window.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-125px)] py-10 bg-white">
      <div className="max-w-frame mx-auto px-4 xl:px-0">
        <OrderHeader />
        {isFetchingSummary ? (
          <IsLoading />
        ) : errorMessage && !Object.keys(validationErrors).length ? (
          <div className="text-red-500">{errorMessage}</div>
        ) : (
          <div className="flex flex-col lg:flex-row space-y-5 lg:space-y-0 lg:space-x-5 items-start">
            <div className="w-full flex flex-col space-y-5">
              {errorMessage && (
                <div className="text-red-500">{errorMessage}</div>
              )}
              <DeliveryAddressForm
                deliveryAddress={deliveryAddress}
                onChange={handleDeliveryAddressChange}
                errors={validationErrors}
              />
              <DeliveryPinPicker pin={pin} onChange={setPin} />
              <PaystackNotice />
            </div>
            {orderSummary && (
              <OrderSummary
                orderSummary={orderSummary}
                onSubmit={handleSubmit}
                isSubmitting={isSubmitting}
              />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
