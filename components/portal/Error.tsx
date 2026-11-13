import { AlertTriangle } from "lucide-react"; // You can replace with any icon lib

const Error = ({ onRetry }: { onRetry?: () => void }) => {
  return (
    <div className="min-h-[100dvh] bg-[#edeef1] flex flex-col items-center justify-center text-center px-6 py-12">
      <AlertTriangle className="h-12 w-12 text-red-500 mb-4" />
      <h2 className="text-xl font-semibold text-gray-800 mb-2">
        An unexpected error occurred
      </h2>
      <p className="text-gray-600 mb-6">
        Please try again or come back later.
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800 transition"
        >
          Try again
        </button>
      )}
    </div>
  );
};

export default Error;
