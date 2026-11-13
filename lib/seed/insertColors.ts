import { prisma } from "@/lib/utils/prisma";

// Colours offered in the product form (reference data). Idempotent.
async function insertColors() {
  await prisma.couleur.createMany({
    data: [
      { nom: "Black", code: "#000000" },
      { nom: "White", code: "#FFFFFF" },
      { nom: "Red", code: "#FF0000" },
      { nom: "Blue", code: "#0000FF" },
      { nom: "Green", code: "#008000" },
      { nom: "Yellow", code: "#FFFF00" },
      { nom: "Orange", code: "#FFA500" },
      { nom: "Pink", code: "#FFC0CB" },
      { nom: "Grey", code: "#808080" },
      { nom: "Brown", code: "#8B4513" },
      { nom: "Purple", code: "#800080" },
      { nom: "Beige", code: "#F5F5DC" },
    ],
    skipDuplicates: true,
  });
  console.log("Colours ready.");
}

export default insertColors;
