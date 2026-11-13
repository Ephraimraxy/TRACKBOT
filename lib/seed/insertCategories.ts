import { prisma } from "@/lib/utils/prisma";

// Product categories (reference data the product form needs). Idempotent.
async function insertCategories() {
  await prisma.categorie.createMany({
    data: [
      { nom: "Tops", description: "T-shirts, shirts, sweaters and other upper-body clothing." },
      { nom: "Bottoms", description: "Trousers, jeans, shorts and other lower-body clothing." },
      { nom: "Dresses & Sets", description: "Dresses and matching sets for all occasions." },
      { nom: "Jackets & Coats", description: "Light jackets, winter coats and bomber jackets." },
      { nom: "Footwear", description: "Sneakers, boots, sandals and other types of footwear." },
      { nom: "Accessories", description: "Bags, scarves, belts and other accessories." },
      { nom: "Other", description: "Miscellaneous items that do not fit in other categories." },
      // General marketplace departments
      { nom: "Phones & Tablets", description: "Smartphones, power banks, earbuds, cables and other phone accessories." },
      { nom: "TV & Audio", description: "Televisions, speakers, headphones and projectors." },
      { nom: "Computing", description: "Laptops, monitors, keyboards, mice and storage." },
      { nom: "Home Appliances", description: "Kettles, fans, irons and other appliances for the home." },
      { nom: "Furniture & Decor", description: "Sofas, chairs, shelves, lamps and clocks." },
      { nom: "Kitchen & Dining", description: "Cookware, plates, glasses, cutlery and kitchen tools." },
      { nom: "Beauty & Personal Care", description: "Makeup, skin care, soap and hair care." },
      { nom: "Sports & Fitness", description: "Weights, mats, balls and training gear." },
      { nom: "Groceries", description: "Rice, oil, honey, spices, coffee and fresh produce." },
      { nom: "Baby & Kids", description: "Strollers, cots, feeding bottles and baby clothes." },
      { nom: "Toys & Games", description: "Soft toys, board games, puzzles and model cars." },
      { nom: "Automotive", description: "Tyres, oil, seat covers and car accessories." },
      { nom: "Tools & Building", description: "Hand tools, paint, cement and tiles." },
      { nom: "Fabrics & Sewing", description: "Wax print, lace and brocade fabrics, sewing machines and notions." },
      { nom: "Books & Stationery", description: "Notebooks, pens, calculators and art supplies." },
      { nom: "Garden & Outdoors", description: "Plants, garden tools, camping gear and lanterns." },
    ],
    skipDuplicates: true,
  });
  console.log("Categories ready.");
}

export default insertCategories;
