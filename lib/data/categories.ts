import { CategoryFromAPI } from "@/lib/types/category.types";

const categories: CategoryFromAPI[] = [
  {
    id: "1",
    nom: "Tops",
    description:
      "T-shirts, shirts, sweaters and other upper-body clothing.",
  },
  {
    id: "2",
    nom: "Bottoms",
    description:
      "Trousers, jeans, shorts and other lower-body clothing.",
  },
  {
    id: "3",
    nom: "Dresses & Sets",
    description: "Dresses and matching sets for all occasions.",
  },
  {
    id: "4",
    nom: "Jackets & Coats",
    description: "Light jackets, winter coats and bomber jackets.",
  },
  {
    id: "5",
    nom: "Footwear",
    description: "Sneakers, boots, sandals and other types of footwear.",
  },
  {
    id: "6",
    nom: "Accessories",
    description: "Bags, scarves, belts and other accessories.",
  },
  {
    id: "7",
    nom: "Other",
    description: "Miscellaneous items that do not fit in other categories.",
  },
];

export default categories;
