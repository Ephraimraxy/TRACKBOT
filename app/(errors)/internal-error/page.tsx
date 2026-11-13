import { T } from "@/components/i18n/T";
import Link from "next/link";

export default function InternalServerErrorPage() {
  return (
    <main className="min-h-[100vh] flex flex-col items-center justify-center space-y-5 bg-gray-50 py-12">
      {/* Illustration ou icône */}
      <div className="text-9xl text-gray-300 animate-pulse">
        <span role="img" aria-label="Exploding head">
          💥
        </span>
      </div>

      {/* Titre */}
      <h2 className="text-4xl font-bold text-gray-900">
        <T>Oops! Internal server error</T>
      </h2>

      {/* Message d'erreur */}
      <p className="text-lg text-gray-600 text-center max-w-md">
        <T>An unexpected error occurred on our side. We are doing our best to fix it.</T>
      </p>

      {/* Bouton pour retourner à l'accueil */}
      <Link
        href="/"
        className="mt-6 px-6 py-3 bg-black text-white font-semibold rounded-lg hover:bg-gray-800 transition-colors duration-300"
      >
        <T>Back to home</T>
      </Link>
    </main>
  );
}
