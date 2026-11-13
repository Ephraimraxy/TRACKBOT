import { MORE_CATALOG } from "@/lib/seed/catalogDataMore";

/**
 * The opening catalogue: 7 categories x 6 products, with photos from Unsplash (Unsplash License:
 * free to use, including commercially, no permission or credit required). Each photo was looked at
 * before it was chosen, and brand-name items were left out so no one else's trademark appears on
 * a product the shop does not sell.
 *
 * Prices (in naira), stock, and descriptions are starting values for the shop owner to edit in
 * Admin > Shop at any time; they are not taken from a real price list. Colours listed are only the
 * ones visible in the photo.
 */
export interface CatalogProduct {
  nom: string;
  categorie: string;
  /** null for items that are not clothing (electronics, groceries, tools...). */
  genre: "Men" | "Women" | "Children" | "Unisex" | null;
  /** Price in naira. */
  prix: number;
  stock: number;
  couleurs: string[];
  tailles: string[];
  /** One-line summary shown under the name. */
  objet: string;
  description: string;
  /** Unsplash photo id, e.g. "photo-1651761179569-4ba2aa054997". */
  photo: string;
}

const CLOTHING = ["S", "M", "L", "XL"];
const CLOTHING_WIDE = ["S", "M", "L", "XL", "XXL"];
const MEN_SHOES = ["40", "41", "42", "43", "44", "45"];
const WOMEN_SHOES = ["36", "37", "38", "39", "40", "41"];

/** Fashion: the first 7 categories. */
export const FASHION_CATALOG: CatalogProduct[] = [
  // ---- Tops ----
  { nom: "White Crew-Neck T-Shirt", categorie: "Tops", genre: "Unisex", prix: 8500, stock: 60, couleurs: ["White"], tailles: CLOTHING_WIDE, photo: "photo-1651761179569-4ba2aa054997",
    objet: "Plain white short-sleeve t-shirt.", description: "A plain white crew-neck t-shirt with short sleeves and a relaxed everyday fit. Easy to wear on its own or under a jacket." },
  { nom: "Short-Sleeve Casual Shirt", categorie: "Tops", genre: "Men", prix: 14500, stock: 28, couleurs: ["Green"], tailles: ["M", "L", "XL", "XXL"], photo: "photo-1591357037205-166318b51afd",
    objet: "Sage green short-sleeve shirt with a camp collar.", description: "A sage green short-sleeve shirt with an open camp collar and a loose, breathable cut. Wear it untucked for warm days." },
  { nom: "Classic White Polo Shirt", categorie: "Tops", genre: "Men", prix: 9800, stock: 45, couleurs: ["White"], tailles: CLOTHING_WIDE, photo: "photo-1671438118097-479e63198629",
    objet: "White polo shirt with a ribbed collar.", description: "A white polo shirt with a ribbed collar and short sleeves. Smart enough for the office, easy enough for the weekend." },
  { nom: "Chunky Knit Sweater", categorie: "Tops", genre: "Unisex", prix: 19500, stock: 22, couleurs: ["Brown"], tailles: CLOTHING, photo: "photo-1631541909061-71e349d1f203",
    objet: "Thick knit sweater in an earthy brown.", description: "A thick, chunky-knit pullover in an earthy brown with a relaxed fit and turn-back sleeves. Warm for cool evenings and the harmattan season." },
  { nom: "Red V-Neck Blouse", categorie: "Tops", genre: "Women", prix: 13500, stock: 26, couleurs: ["Red"], tailles: CLOTHING, photo: "photo-1761117228880-df2425bd70da",
    objet: "Long-sleeve blouse in red with a V neckline.", description: "A red long-sleeve blouse with a V neckline and a smooth drape. Pairs with tailored trousers or a skirt." },
  { nom: "Camisole Top", categorie: "Tops", genre: "Women", prix: 6500, stock: 70, couleurs: ["Black", "Grey", "White"], tailles: ["S", "M", "L"], photo: "photo-1525171254930-643fc658b64e",
    objet: "Thin-strap camisole in black, grey and white.", description: "A light thin-strap camisole that sits easily under blazers and cardigans or works on its own in the heat." },

  // ---- Bottoms ----
  { nom: "High-Waist Straight Jeans", categorie: "Bottoms", genre: "Women", prix: 24000, stock: 30, couleurs: ["Blue"], tailles: CLOTHING, photo: "photo-1598554747436-c9293d6a588f",
    objet: "High-waist straight-leg jeans in mid blue.", description: "Mid-blue denim jeans with a high waist and a straight leg. A wardrobe staple that works with sneakers or heels." },
  { nom: "Beige Chino Trousers", categorie: "Bottoms", genre: "Men", prix: 18500, stock: 34, couleurs: ["Beige"], tailles: ["M", "L", "XL", "XXL"], photo: "photo-1788380944948-f5fe4a3b3a13",
    objet: "Straight-cut chinos in beige.", description: "Straight-cut beige chino trousers in a smooth lightweight fabric. Dress them up with a shirt or down with a polo." },
  { nom: "Distressed Denim Shorts", categorie: "Bottoms", genre: "Women", prix: 12500, stock: 38, couleurs: ["Blue"], tailles: ["S", "M", "L"], photo: "photo-1591195853828-11db59a44f6b",
    objet: "Light-wash denim shorts with a rolled hem.", description: "Light-wash high-waist denim shorts with a distressed finish and a rolled hem. Made for hot weather." },
  { nom: "Yellow Gingham Skirt", categorie: "Bottoms", genre: "Women", prix: 15000, stock: 20, couleurs: ["Yellow"], tailles: ["S", "M", "L"], photo: "photo-1509182469511-7f0b50bfa63e",
    objet: "Flowing midi skirt in yellow gingham.", description: "A flowing midi skirt in a yellow and white gingham check that moves nicely when you walk." },
  { nom: "Grey Jogger Pants", categorie: "Bottoms", genre: "Unisex", prix: 14000, stock: 50, couleurs: ["Grey"], tailles: CLOTHING_WIDE, photo: "photo-1789110520164-2389992e5d0f",
    objet: "Soft grey joggers with elastic cuffs.", description: "Soft grey jogger pants with an elastic waist and cuffs. Comfortable for the gym, the house, or a day out." },
  { nom: "Black Leggings", categorie: "Bottoms", genre: "Women", prix: 9500, stock: 55, couleurs: ["Black"], tailles: CLOTHING, photo: "photo-1626026397008-3316047db4fc",
    objet: "High-waist stretch leggings in black.", description: "High-waist black leggings with plenty of stretch for exercise, yoga, or everyday wear." },

  // ---- Dresses & Sets ----
  { nom: "Blue Puff-Sleeve Dress", categorie: "Dresses & Sets", genre: "Women", prix: 26500, stock: 18, couleurs: ["Blue"], tailles: ["S", "M", "L"], photo: "photo-1763604996066-73160867c1fc",
    objet: "Button-front dress in blue with puff sleeves.", description: "A light blue button-front dress with puff sleeves, a fitted waist and a flared hem." },
  { nom: "Floral Midi Sundress", categorie: "Dresses & Sets", genre: "Women", prix: 23000, stock: 16, couleurs: ["White"], tailles: ["S", "M", "L"], photo: "photo-1762154057377-cc9d3dd6900c",
    objet: "Strappy midi dress with a colourful floral print.", description: "A white strappy midi sundress covered in a colourful floral print, with a full skirt for warm days." },
  { nom: "Ankara Print Dress", categorie: "Dresses & Sets", genre: "Women", prix: 32000, stock: 14, couleurs: ["Yellow", "Purple", "Blue"], tailles: CLOTHING, photo: "photo-1601653233006-5c9fd30eab12",
    objet: "Sleeveless dress in a bold African wax print.", description: "A sleeveless dress in a bold, colourful African wax print. A confident choice for weddings and celebrations." },
  { nom: "Emerald Evening Gown", categorie: "Dresses & Sets", genre: "Women", prix: 65000, stock: 8, couleurs: ["Green"], tailles: ["S", "M", "L"], photo: "photo-1765871421513-452fe03d15cc",
    objet: "Floor-length sparkling gown in emerald green.", description: "A floor-length emerald green gown with a sparkling finish, a V neckline and a full skirt for formal evenings." },
  { nom: "Tiered Maxi Dress", categorie: "Dresses & Sets", genre: "Women", prix: 28500, stock: 17, couleurs: ["Green"], tailles: CLOTHING, photo: "photo-1685703203919-0c2cfc893c60",
    objet: "Long tiered dress in green with full sleeves.", description: "A long green maxi dress with tiered layers, a V neckline and full sleeves. Light and flowing." },
  { nom: "Printed Two-Piece Set", categorie: "Dresses & Sets", genre: "Women", prix: 34000, stock: 12, couleurs: ["Grey", "Black"], tailles: CLOTHING, photo: "photo-1763818104121-7d63caa456f1",
    objet: "Matching printed top and trousers set.", description: "A matching two-piece set: a loose printed top and trousers in a grey and black leaf print." },

  // ---- Jackets & Coats ----
  { nom: "Denim Trucker Jacket", categorie: "Jackets & Coats", genre: "Men", prix: 32000, stock: 15, couleurs: ["Blue"], tailles: ["M", "L", "XL", "XXL"], photo: "photo-1611312449408-fcece27cdbb7",
    objet: "Dark denim jacket with a corduroy collar.", description: "A dark indigo denim trucker jacket with chest pockets, contrast stitching and a corduroy collar." },
  { nom: "Black Leather Biker Jacket", categorie: "Jackets & Coats", genre: "Men", prix: 85000, stock: 6, couleurs: ["Black"], tailles: ["M", "L", "XL"], photo: "photo-1727515546577-f7d82a47b51d",
    objet: "Black biker jacket with an asymmetric zip.", description: "A black biker-style jacket with an asymmetric front zip, zipped pockets and a fitted cut." },
  { nom: "Zip-Up Bomber Jacket", categorie: "Jackets & Coats", genre: "Men", prix: 38000, stock: 14, couleurs: ["Orange"], tailles: ["M", "L", "XL"], photo: "photo-1591047139829-d91aecb6caea",
    objet: "Lightweight bomber jacket in rust orange.", description: "A lightweight rust-orange bomber jacket with a front zip, ribbed hem and plain, clean styling." },
  { nom: "Belted Trench Coat", categorie: "Jackets & Coats", genre: "Women", prix: 58000, stock: 9, couleurs: ["Beige"], tailles: ["S", "M", "L"], photo: "photo-1633821879282-0c4e91f96232",
    objet: "Classic belted trench coat in beige.", description: "A classic beige trench coat with a tie belt, wide lapels and epaulettes on the shoulders." },
  { nom: "Padded Puffer Jacket", categorie: "Jackets & Coats", genre: "Unisex", prix: 45000, stock: 12, couleurs: ["Black"], tailles: ["M", "L", "XL", "XXL"], photo: "photo-1769689387719-f11faac08cbe",
    objet: "Glossy black padded jacket with a hood.", description: "A glossy black padded puffer jacket with a hood and an elastic hem for cold weather." },
  { nom: "Single-Breasted Blazer", categorie: "Jackets & Coats", genre: "Unisex", prix: 42000, stock: 11, couleurs: ["Green"], tailles: CLOTHING, photo: "photo-1770757587875-18505e8c4054",
    objet: "Relaxed single-breasted blazer in deep green.", description: "A relaxed single-breasted blazer in a deep green with notch lapels and flap pockets." },

  // ---- Footwear ----
  { nom: "White Lace-Up Sneakers", categorie: "Footwear", genre: "Unisex", prix: 35000, stock: 24, couleurs: ["White"], tailles: ["38", "39", "40", "41", "42", "43", "44", "45"], photo: "photo-1718802312665-d8219d8c64ed",
    objet: "Clean white leather-look lace-up sneakers.", description: "White lace-up sneakers with a clean low-top design and a cushioned sole, for everyday wear." },
  { nom: "Brown Leather Loafers", categorie: "Footwear", genre: "Men", prix: 28000, stock: 16, couleurs: ["Brown"], tailles: MEN_SHOES, photo: "photo-1662541089338-c7d53b88be70",
    objet: "Slip-on loafers in tan brown leather.", description: "Slip-on loafers in tan brown with a soft leather upper and a flexible sole." },
  { nom: "Embellished Leather Sandals", categorie: "Footwear", genre: "Women", prix: 16500, stock: 22, couleurs: ["Beige"], tailles: WOMEN_SHOES, photo: "photo-1618615098938-84fc29796e76",
    objet: "Flat sandals with a beaded strap.", description: "Flat beige leather sandals with a beaded and pearl-style strap across the foot." },
  { nom: "Tan Ankle Boots", categorie: "Footwear", genre: "Unisex", prix: 42000, stock: 10, couleurs: ["Brown"], tailles: ["39", "40", "41", "42", "43", "44", "45"], photo: "photo-1605733160314-4fc7dac4bb16",
    objet: "Ankle boots in tan with a side zip.", description: "Tan ankle boots with a side zip, stud detail and a thick rubber sole." },
  { nom: "Nude Pointed Pumps", categorie: "Footwear", genre: "Women", prix: 24500, stock: 14, couleurs: ["Beige"], tailles: WOMEN_SHOES, photo: "photo-1535043934128-cf0b28d52f95",
    objet: "Pointed-toe stiletto pumps in nude.", description: "Nude pointed-toe stiletto pumps that go with almost any outfit, from work to evening." },
  { nom: "Black Slide Sandals", categorie: "Footwear", genre: "Unisex", prix: 6500, stock: 80, couleurs: ["Black"], tailles: ["38", "39", "40", "41", "42", "43", "44", "45"], photo: "photo-1764471444628-51c4189ec183",
    objet: "Open-toe slides in plain black.", description: "Plain black open-toe slides with a moulded sole. Light, quick to put on and easy to clean." },

  // ---- Accessories ----
  { nom: "Grey Leather Satchel", categorie: "Accessories", genre: "Women", prix: 38000, stock: 10, couleurs: ["Grey"], tailles: ["Standard"], photo: "photo-1605733513597-a8f8341084e6",
    objet: "Structured satchel with buckle straps and a handle.", description: "A structured grey satchel with a top handle, two buckle straps and a removable shoulder strap." },
  { nom: "Woven Leather Belt", categorie: "Accessories", genre: "Men", prix: 11500, stock: 40, couleurs: ["Brown"], tailles: ["Standard"], photo: "photo-1711443982852-b3df5c563448",
    objet: "Braided brown belt with a metal buckle.", description: "A braided brown belt with a polished metal pin buckle, a smart finish for trousers and chinos." },
  { nom: "Round Metal-Frame Sunglasses", categorie: "Accessories", genre: "Unisex", prix: 9500, stock: 45, couleurs: ["Grey"], tailles: ["Standard"], photo: "photo-1511499767150-a48a237f0083",
    objet: "Round gold-frame sunglasses with dark lenses.", description: "Round sunglasses with thin gold-coloured metal frames and dark green-grey lenses." },
  { nom: "Plain White Baseball Cap", categorie: "Accessories", genre: "Unisex", prix: 5500, stock: 65, couleurs: ["White"], tailles: ["Standard"], photo: "photo-1691256676359-20e5c6d4bc92",
    objet: "Six-panel white cap with a curved brim.", description: "A plain white six-panel baseball cap with a curved brim. No logos, so it goes with everything." },
  { nom: "Soft Green Scarf", categorie: "Accessories", genre: "Women", prix: 7500, stock: 33, couleurs: ["Green"], tailles: ["Standard"], photo: "photo-1643312892626-80632ef6d7dc",
    objet: "Lightweight scarf in olive green with a fringed edge.", description: "A lightweight olive green scarf with a soft drape and a fringed edge. Wear it around the neck or over the shoulders." },
  { nom: "Leather Messenger Bag", categorie: "Accessories", genre: "Men", prix: 46000, stock: 8, couleurs: ["Brown"], tailles: ["Standard"], photo: "photo-1473188588951-666fce8e7c68",
    objet: "Brown messenger bag with two buckle flaps.", description: "A brown messenger bag in a worn leather look, with two buckle flaps and a long cross-body strap." },

  // ---- Other ----
  { nom: "Slim Card Holder Set", categorie: "Other", genre: "Unisex", prix: 8500, stock: 42, couleurs: ["Black"], tailles: ["Standard"], photo: "photo-1601592996763-f05c9c80a7f1",
    objet: "Two slim black card holders.", description: "Two slim black card holders with a textured finish, small enough for a pocket." },
  { nom: "Leather Backpack", categorie: "Other", genre: "Unisex", prix: 39500, stock: 12, couleurs: ["Red"], tailles: ["Standard"], photo: "photo-1622560480605-d83c853bc5c3",
    objet: "Burgundy backpack with a front pocket.", description: "A burgundy backpack with a zipped front pocket, padded straps and a top carry handle." },
  { nom: "Glass Perfume Bottle, 50 ml", categorie: "Other", genre: "Unisex", prix: 25000, stock: 20, couleurs: [], tailles: ["Standard"], photo: "photo-1761659760494-32b921a2449f",
    objet: "Spray perfume in a clear glass bottle.", description: "A fragrance in a clear glass spray bottle, 50 ml." },
  { nom: "Knit Socks, 3 Pairs", categorie: "Other", genre: "Unisex", prix: 4500, stock: 90, couleurs: ["Grey", "Purple", "Yellow"], tailles: ["Standard"], photo: "photo-1615486364462-ef6363adbc18",
    objet: "Three pairs of soft knit socks in grey, purple and yellow.", description: "Three pairs of soft textured knit socks, one grey, one purple and one yellow." },
  { nom: "Compact Black Umbrella", categorie: "Other", genre: "Unisex", prix: 6000, stock: 35, couleurs: ["Black"], tailles: ["Standard"], photo: "photo-1541697183324-e15d407c91cf",
    objet: "Black umbrella with a curved handle.", description: "A black umbrella with a curved handle and a wide canopy for the rainy season." },
  { nom: "Steel Water Bottle", categorie: "Other", genre: "Unisex", prix: 7000, stock: 48, couleurs: ["Green"], tailles: ["Standard"], photo: "photo-1602143407151-7111542de6e8",
    objet: "Reusable bottle in matte green steel.", description: "A reusable water bottle in matte green steel with a screw cap. No logos." },
];

/** The whole opening catalogue: fashion first, then the other departments. */
export const CATALOG: CatalogProduct[] = [...FASHION_CATALOG, ...MORE_CATALOG];

export const IMAGE_URL = (photo: string, width = 1000) =>
  `https://images.unsplash.com/${photo}?w=${width}&q=80&fm=jpg&fit=crop`;
