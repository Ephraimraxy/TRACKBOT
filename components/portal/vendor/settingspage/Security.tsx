import { useState } from "react";
import { toast } from "sonner";
import { fetchDataFromAPI } from "@/lib/utils/fetchData";
import { Shield } from "lucide-react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PASSWORD_MIN } from "@/lib/constants/password";

interface SecurityProps {
  userId: string;
}

export default function Security({ userId }: SecurityProps) {
  const router = useRouter();

  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPasswordData({ ...passwordData, [e.target.name]: e.target.value });
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error("The new passwords do not match");
      return;
    }
    if (passwordData.newPassword.length < PASSWORD_MIN) {
      toast.error(`The password must contain at least ${PASSWORD_MIN} characters`);
      return;
    }
    setIsLoading(true);
    const result = await fetchDataFromAPI<null>(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
      }),
    });
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

  const handleDeleteAccount = async () => {
    if (
      confirm(
        "Are you sure you want to delete your account? This action cannot be undone."
      )
    ) {
      setIsLoading(true);
      const result = await fetchDataFromAPI<null>(`/api/users/${userId}`, {
        method: "DELETE",
      });
      if (result.error) {
        toast.error(result.error);
      } else {
        await signOut({ redirect: false });
        toast.success("Account deleted successfully");
        router.push("/");
        router.refresh();
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      <div className="p-6 border-b">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5 text-black" />
          Security
        </h2>
        <p className="text-sm text-gray-500">
          Update your password or delete your account.
        </p>
      </div>
      <form onSubmit={handlePasswordSubmit} className="p-6 space-y-6">
        <div className="space-y-2">
          <label
            htmlFor="currentPassword"
            className="block text-sm font-medium"
          >
            Current password
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            value={passwordData.currentPassword}
            onChange={handlePasswordChange}
            required
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="newPassword" className="block text-sm font-medium">
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            value={passwordData.newPassword}
            onChange={handlePasswordChange}
            required
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>
        <div className="space-y-2">
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium"
          >
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            value={passwordData.confirmPassword}
            onChange={handlePasswordChange}
            required
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>
        <button
          type="submit"
          className="bg-black text-white px-4 py-2 rounded-md hover:bg-black/90 disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? "Updating..." : "Update password"}
        </button>
      </form>
      <div className="p-6 border-t">
        <button
          onClick={handleDeleteAccount}
          className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 disabled:opacity-50"
          disabled={isLoading}
        >
          Delete account
        </button>
      </div>
    </div>
  );
}
