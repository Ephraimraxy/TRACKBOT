import React, { useState } from "react";
import { PasswordInput } from "@/components/ui/input";
import { toast } from "sonner";
import { fetchDataFromAPI } from "@/lib/utils/fetchData";
import { UserFromAPI } from "@/lib/types/user.types";
import { Shield } from "lucide-react";

interface SecurityProps {
  user: UserFromAPI;
  onUpdate: (updatedUser: UserFromAPI) => void;
}

export default function Security({ user }: SecurityProps) {
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPasswordData({ ...passwordData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error("The passwords do not match");
      return;
    }
    setIsLoading(true);
    const result = await fetchDataFromAPI<UserFromAPI>(
      `/api/users/${user.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword,
        }),
      }
    );
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Password updated successfully");
      setPasswordData({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    }
    setIsLoading(false);
  };

  return (
    <div className="space-y-6 bg-gray-100 p-6 rounded-lg shadow-inner mt-6">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        <Shield className="h-6 w-6 text-gray-700" />
        Security
      </h2>
      <div className="space-y-4">
        <div>
          <label
            htmlFor="currentPassword"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Current password
          </label>
          <PasswordInput
            id="currentPassword"
            name="currentPassword"
            value={passwordData.currentPassword}
            onChange={handleChange}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200 text-gray-800 placeholder-gray-500 shadow-sm text-base"
            placeholder="••••••••"
          />
        </div>
        <div>
          <label
            htmlFor="newPassword"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            New password
          </label>
          <PasswordInput
            id="newPassword"
            name="newPassword"
            value={passwordData.newPassword}
            onChange={handleChange}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200 text-gray-800 placeholder-gray-500 shadow-sm text-base"
            placeholder="••••••••"
          />
        </div>
        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Confirm password
          </label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            value={passwordData.confirmPassword}
            onChange={handleChange}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200 text-gray-800 placeholder-gray-500 shadow-sm text-base"
            placeholder="••••••••"
          />
        </div>
        <button
          onClick={handleSubmit}
          className="bg-black text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-all duration-300 shadow-md transform hover:-translate-y-1 font-semibold text-base"
          disabled={isLoading}
        >
          {isLoading ? "Saving..." : "Change password"}
        </button>
      </div>
    </div>
  );
}
