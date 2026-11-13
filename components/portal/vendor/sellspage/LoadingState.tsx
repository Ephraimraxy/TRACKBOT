"use client";

import SpinnerLoader from "@/components/ui/SpinnerLoader";

export default function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <SpinnerLoader className="w-8 h-8" />
        <p className="mt-4 text-gray-600">Loading sales...</p>
      </div>
    </div>
  );
}
