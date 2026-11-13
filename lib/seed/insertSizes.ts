import { prisma } from "@/lib/utils/prisma";

// Sizes offered in the product form (reference data). Idempotent.
async function insertSizes() {
  const names = [
    "Standard",
    // Adult clothing
    "S", "M", "L", "XL", "XXL", "3XL",
    // Children's clothing
    "2Y", "3Y", "4Y", "5Y", "6Y",
    // Shoes (EU sizes)
    ...Array.from({ length: 20 }, (_, i) => String(27 + i)),
  ];
  await prisma.taille.createMany({ data: names.map((nom) => ({ nom })), skipDuplicates: true });
  console.log("Sizes ready.");
}

export default insertSizes;
