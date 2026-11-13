"use client";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ReportCard({ productId }: { productId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [reportType, setReportType] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const reportTypes = [
    { id: "counterfeit", label: "Counterfeit product" },
    { id: "defective", label: "Defective product" },
    { id: "incorrect", label: "Incorrect description" },
    { id: "inappropriate", label: "Inappropriate content" },
    { id: "other", label: "Other problem" },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!reportType) {
      setError("Please select a report type");
      return;
    }

    if (!productId) {
      setError("Product ID missing");
      return;
    }

    setIsSubmitting(true);

    const selectedReport = reportTypes.find((type) => type.id === reportType);
    const payload = {
      objet: selectedReport?.label || "",
      produitId: productId,
      ...(reportDetails && { text: reportDetails }),
    };

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || "Error while sending the report"
        );
      }

      setSuccess(true);
      setTimeout(() => {
        router.push(`/product/${productId}`);
      }, 2000);
    } catch (error) {
      console.error("Report submission error:", error);
      setError(
        `${error || "Failed to submit the report. Please try again."}`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="w-full max-w-md flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-10 w-10 text-green-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-3xl font-bold text-gray-800 mb-3"><T>Thank you</T></h2>
          <p className="text-gray-600 mb-6">
            <T>Your report was submitted successfully.</T>
          </p>
          <div className="text-sm text-blue-500">
            <T>Redirecting to the product...</T>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
        <div className="bg-black p-6 text-center">
          <h2 className="text-2xl font-bold text-white"><T>Report this product</T></h2>
          <p className="text-gray-100 mt-1">
            <T>Help us maintain the quality of our platform</T>
          </p>
        </div>

        <div className="p-8">
          {error && (
            <div className="mb-6 p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 mr-2"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                <T>What is wrong with this product?</T>
              </label>

              <div className="space-y-2">
                {reportTypes.map((type) => (
                  <div key={type.id} className="flex items-center">
                    <input
                      id={`report-type-${type.id}`}
                      name="reportType"
                      type="radio"
                      value={type.id}
                      checked={reportType === type.id}
                      onChange={() => setReportType(type.id)}
                      className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
                    />
                    <label
                      htmlFor={`report-type-${type.id}`}
                      className="ml-3 block text-sm font-medium text-gray-700"
                    >
                      {type.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-8">
              <label
                htmlFor="reportDetails"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                <T>Report details</T>
              </label>
              <textarea
                id="reportDetails"
                name="reportDetails"
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all"
                placeholder={t("Provide more details about the problem...")}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || reportType === ""}
              className={`w-full py-3 px-4 rounded-xl font-medium text-white transition-all duration-200 ${
                isSubmitting
                  ? "bg-gray-700"
                  : reportType === ""
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-red-600 hover:bg-red-700 shadow-md hover:shadow-lg"
              }`}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  <T>Sending...</T>
                </span>
              ) : (
                "Submit the report"
              )}
            </button>
          </form>
        </div>
      </div>

      <div className="mt-6 text-center">
        <button
          onClick={() => router.back()}
          className="text-sm text-gray-600 hover:text-black font-medium"
        >
          <T>← Back to the product page</T>
        </button>
      </div>
    </div>
  );
}
