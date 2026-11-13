"use client";

import { useState } from "react";
import { toast } from "sonner";
import { fetchDataFromAPI } from "@/lib/utils/fetchData";
import { UserFromAPI } from "@/lib/types/user.types";
import { CreditCard, Building } from "lucide-react";
import MDEditor from "@uiw/react-md-editor";
import { Vendeur } from "@prisma/client";

interface VendorSettingsProps {
  user: UserFromAPI;
  onUpdate: (updatedVendorInfo: Vendeur) => void;
}

export default function VendorSettings({
  user,
  onUpdate,
}: VendorSettingsProps) {
  const [vendorInfo, setVendorInfo] = useState({
    nomBoutique: user.vendeur?.nomBoutique || "",
    description: user.vendeur?.description || "",
    nomBanque: user.vendeur?.nomBanque || "",
    rib: user.vendeur?.rib || "",
  });
  const [isLoading, setIsLoading] = useState(false);

  const handleVendorInfoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVendorInfo({ ...vendorInfo, [e.target.name]: e.target.value });
  };

  const handleDescriptionChange = (value?: string) => {
    setVendorInfo({ ...vendorInfo, description: value || "" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorInfo.nomBoutique || !vendorInfo.nomBanque || !vendorInfo.rib) {
      toast.error("Please fill in all required fields");
      return;
    }
    setIsLoading(true);
    const result = await fetchDataFromAPI<Vendeur>(
      `/api/users/${user.id}/settings/vendor-status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomBoutique: vendorInfo.nomBoutique,
          description: vendorInfo.description,
          nomBanque: vendorInfo.nomBanque,
          rib: vendorInfo.rib,
        }),
      }
    );
    if (result.error) {
      toast.error(result.error);
    } else {
      onUpdate(result.data!);
      toast.success(
        result.message || "Vendor information updated successfully"
      );
    }
    setIsLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Building className="h-5 w-5 text-black" />
            Business information
          </h2>
          <p className="text-sm text-gray-500">
            Update your business details
          </p>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-2">
            <label htmlFor="nomBoutique" className="block text-sm font-medium">
              Name of your online shop
            </label>
            <input
              id="nomBoutique"
              name="nomBoutique"
              value={vendorInfo.nomBoutique}
              onChange={handleVendorInfoChange}
              required
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div className="space-y-2" data-color-mode="light">
            <label htmlFor="description" className="block text-sm font-medium">
              Bio (description, markdown accepted)
            </label>
            <MDEditor
              value={vendorInfo.description}
              onChange={handleDescriptionChange}
              style={{ height: "200px" }}
            />
          </div>
        </div>
      </div>
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-black" />
            Bank details
          </h2>
          <p className="text-sm text-gray-500">
            Update your bank details for payouts
          </p>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="nomBanque" className="block text-sm font-medium">
                Bank name
              </label>
              <input
                id="nomBanque"
                name="nomBanque"
                value={vendorInfo.nomBanque}
                onChange={handleVendorInfoChange}
                required
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="rib" className="block text-sm font-medium">
                Account number
              </label>
              <input
                id="rib"
                name="rib"
                value={vendorInfo.rib}
                onChange={handleVendorInfoChange}
                required
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
          </div>
        </div>
        <div className="p-6 border-t">
          <button
            type="submit"
            className="bg-black text-white px-4 py-2 rounded-md hover:bg-black/90 disabled:opacity-50"
            disabled={isLoading}
          >
            {isLoading ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </form>
  );
}
