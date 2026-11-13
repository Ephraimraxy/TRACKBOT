import { T } from "@/components/i18n/T";
import { useState } from "react";
import { toast } from "sonner";
import { fetchDataFromAPI } from "@/lib/utils/fetchData";
import { UserFromAPI } from "@/lib/types/user.types";
import { User, Mail } from "lucide-react";
import { useSession } from "next-auth/react";

interface PersonalInfoProps {
  user: UserFromAPI;
  onUpdate: (updatedUser: UserFromAPI) => void;
}

export default function PersonalInfo({ user, onUpdate }: PersonalInfoProps) {
  const { data: session, update } = useSession();
  const [formData, setFormData] = useState({
    nom: user.nom,
    prenom: user.prenom,
    email: user.email,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const result = await fetchDataFromAPI<UserFromAPI>(
      `/api/users/${user.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      }
    );
    if (result.error) {
      toast.error(result.error);
    } else {
      onUpdate(result.data!);
      toast.success("Personal information updated successfully");
    }
    setIsLoading(false);
  };

  const handleVerifyEmail = async () => {
    if (verificationCode.length !== 6) {
      toast.error("The code must contain 6 characters");
      return;
    }
    setIsVerifying(true);
    const result = await fetchDataFromAPI<{ message: string }>(
      "/api/auth/email/update",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          newEmail: user.emailEnAttente,
          code: verificationCode,
        }),
      }
    );
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Email verified successfully");
      setVerificationCode("");
      onUpdate({ ...user, email: user.emailEnAttente!, emailEnAttente: null });
      await update({ ...session });
    }
    setIsVerifying(false);
  };

  return (
    <>
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <User className="h-5 w-5 text-black" />
            <T>Personal information</T>
          </h2>
          <p className="text-sm text-gray-500">
            <T>Update your personal and contact information.</T>
          </p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="prenom" className="block text-sm font-medium">
                <T>First name</T>
              </label>
              <input
                id="prenom"
                name="prenom"
                value={formData.prenom}
                onChange={handleChange}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="nom" className="block text-sm font-medium">
                <T>Last name</T>
              </label>
              <input
                id="nom"
                name="nom"
                value={formData.nom}
                onChange={handleChange}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm font-medium">
              <T>Email</T>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <button
            type="submit"
            className="bg-black text-white px-4 py-2 rounded-md hover:bg-black/90 disabled:opacity-50"
            disabled={isLoading}
          >
            {isLoading ? "Saving..." : "Save changes"}
          </button>
        </form>
      </div>

      {/* Email Verification Section */}
      {user.emailEnAttente && (
        <div className="mt-6 p-6 bg-white rounded-xl border shadow-sm">
          <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <Mail className="h-5 w-5 text-black" />
            <T>Email address verification</T>
          </h3>
          <p className="text-sm text-gray-700">
            <T>A 6-digit verification code was sent to:</T>{" "}
            <span className="font-medium">{user.emailEnAttente}</span>
          </p>
          <p className="text-sm text-gray-600">
            <T>Please enter this code below to confirm your new email address.</T>
            <br />
            <span className="text-red-500 font-medium">
              <T>⚠️ The code is valid for 5 minutes.</T>
            </span>
          </p>

          <div className="space-y-2 mt-4">
            <input
              type="text"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              placeholder="Enter the code"
              className="w-full px-3 py-2 border rounded-md"
              maxLength={6}
            />
            <button
              onClick={handleVerifyEmail}
              className="bg-black text-white px-4 py-2 rounded-md hover:bg-black/90 disabled:opacity-50"
              disabled={isVerifying || verificationCode.length !== 6}
            >
              {isVerifying ? "Verifying..." : "Verify"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
