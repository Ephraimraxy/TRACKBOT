/**
 * Single source of truth for the name and credits shown across the app.
 * Change `name` here and the header, footer, About page and browser tab follow.
 */
export const BRAND = {
  name: "TrackBot",
  tagline: "Shop, chat and track your order, all in one place.",
  projectTitle:
    "Development of Tracker Based Chat Bot System for Small E-Commerce Business",
  degree: "BSc Computer Science",
  institution: "Nasarawa State University, Keffi",
  year: 2026,
  supervisor: "Dr. Esther Samuel Alu",
  team: ["Tukur Muhammed Nabil", "Soetan Habib Olajide", "Adukwu Ojochegbe Abraham"],
  // The assistant is the system's own chatbot, so it shares the system name.
  assistantName: "TrackBot",
  currencySymbol: "₦",
  currencyCode: "NGN",
} as const;

/** Credit shown on the About page. */
export const CREDIT = {
  name: "EPHRAIM HOSEA",
  role: "CEO, BURSTBRAIN CONCEPT",
  website: "www.burstbrainconcepts.site",
  websiteUrl: "https://www.burstbrainconcepts.site",
  phone: "+2348087815454",
} as const;
