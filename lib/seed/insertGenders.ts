import { prisma } from "@/lib/utils/prisma";

// Product audiences (reference data). Idempotent.
async function insertGenders() {
  await prisma.genre.createMany({
    data: [{ nom: "Men" }, { nom: "Women" }, { nom: "Children" }, { nom: "Unisex" }],
    skipDuplicates: true,
  });
  console.log("Genders ready.");
}

export default insertGenders;
