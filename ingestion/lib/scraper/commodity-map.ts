/**
 * Explicit commodity and unit mappings.
 *
 * This is a lookup table on purpose. The tempting alternative - lowercase, strip
 * punctuation, collapse whitespace, call it a slug - is destructive in ways that are hard
 * to see afterwards: "Trey Pra (Live)" and "Trey Por" collapse toward each other,
 * "30-35% broken rice" loses the range that distinguishes it from other broken rice, and
 * an unrecognised commodity silently becomes a brand-new series instead of raising a hand.
 *
 * An unmapped name is NOT an error. It is stored with its original text, given a lower
 * confidence, and queued for review - so the answer to a new commodity is to add a line
 * here, not to loosen the matching.
 *
 * Keys are matched after case-folding and whitespace collapsing only.
 */

export interface CommodityDefinition {
  /** Stable machine key the prediction model joins on. */
  normalized: string
  /** Human-facing label for the API and admin UI. */
  label: string
}

/**
 * Names carry footnote markers in the PDFs ("Mixed Rice*"), which are stripped before
 * lookup. Both English and the transliterated Khmer names WFP uses are listed.
 */
export const COMMODITY_MAP: Record<string, CommodityDefinition> = {
  // Cereals
  'mixed rice': { normalized: 'mixed_rice', label: 'Mixed Rice' },
  '30-35% broken rice': { normalized: 'broken_rice_30_35', label: '30-35% Broken Rice' },
  '30 - 35% broken rice': { normalized: 'broken_rice_30_35', label: '30-35% Broken Rice' },
  'broken rice': { normalized: 'broken_rice', label: 'Broken Rice' },

  // Fish
  'snakehead fish (live)': { normalized: 'snakehead_fish_live', label: 'Snakehead Fish (Live)' },
  'snakehead fish': { normalized: 'snakehead_fish', label: 'Snakehead Fish' },
  'trey pra (live)': { normalized: 'trey_pra_live', label: 'Trey Pra (Live)' },
  'catfish (live)': { normalized: 'catfish_live', label: 'Catfish (Live)' },
  'cat-fish (live)': { normalized: 'catfish_live', label: 'Catfish (Live)' },
  'red tailed catfish': { normalized: 'red_tailed_catfish', label: 'Red Tailed Catfish' },
  'dried snake fish': { normalized: 'dried_snakehead_fish', label: 'Dried Snakehead Fish' },
  'broahok': { normalized: 'prahok', label: 'Prahok (Fermented Fish)' },
  'prahok': { normalized: 'prahok', label: 'Prahok (Fermented Fish)' },
  'trey por': { normalized: 'trey_por', label: 'Trey Por' },
  'trey sandai': { normalized: 'trey_sandai', label: 'Trey Sandai' },

  // Meat and eggs
  'pork with fat': { normalized: 'pork_with_fat', label: 'Pork With Fat' },
  'pork ribs': { normalized: 'pork_ribs', label: 'Pork Ribs' },
  'pork bone': { normalized: 'pork_bone', label: 'Pork Bone' },
  'pork legs': { normalized: 'pork_legs', label: 'Pork Legs' },
  'beef with fat': { normalized: 'beef_with_fat', label: 'Beef With Fat' },
  'chicken meat (farm)': { normalized: 'chicken_meat_farm', label: 'Chicken Meat (Farm)' },
  'chicken meat (cp)': { normalized: 'chicken_meat_cp', label: 'Chicken Meat (CP)' },
  'duck egg': { normalized: 'duck_egg', label: 'Duck Egg' },
  'salty duck egg': { normalized: 'salty_duck_egg', label: 'Salty Duck Egg' },

  // Oils, condiments, pulses
  'vegetable oil': { normalized: 'vegetable_oil', label: 'Vegetable Oil' },
  'iodized salt': { normalized: 'iodized_salt', label: 'Iodized Salt' },
  'fish sauce (lobster)': { normalized: 'fish_sauce_lobster', label: 'Fish Sauce (Lobster)' },
  'ground nut': { normalized: 'groundnut', label: 'Groundnut' },
  'groundnut': { normalized: 'groundnut', label: 'Groundnut' },
  'soybean': { normalized: 'soybean', label: 'Soybean' },
  'green bean/mung bean': { normalized: 'mung_bean', label: 'Green Bean / Mung Bean' },

  // Vegetables
  'morning glory': { normalized: 'morning_glory', label: 'Morning Glory' },
  'carrot': { normalized: 'carrot', label: 'Carrot' },
  'ivy gourd leave': { normalized: 'ivy_gourd_leaves', label: 'Ivy Gourd Leaves' },
  'ivy gourd leaves': { normalized: 'ivy_gourd_leaves', label: 'Ivy Gourd Leaves' },
  'moringa leaves': { normalized: 'moringa_leaves', label: 'Moringa Leaves' },
  'chinese spinach': { normalized: 'chinese_spinach', label: 'Chinese Spinach' },
  'pak choi': { normalized: 'pak_choi', label: 'Pak Choi' },
  'chinese flowering cabbage': { normalized: 'chinese_flowering_cabbage', label: 'Chinese Flowering Cabbage' },
  'mustard greens': { normalized: 'mustard_greens', label: 'Mustard Greens' },
  'amaranthus': { normalized: 'amaranthus', label: 'Amaranthus' },
  'ngob leaves': { normalized: 'ngob_leaves', label: 'Ngob Leaves' },
  'pumpkin leaves': { normalized: 'pumpkin_leaves', label: 'Pumpkin Leaves' },
  'pumpkin fruit': { normalized: 'pumpkin_fruit', label: 'Pumpkin Fruit' },
  'bottle gourd': { normalized: 'bottle_gourd', label: 'Bottle Gourd' },
  'wax gourd': { normalized: 'wax_gourd', label: 'Wax Gourd' },
  'ridge gourd': { normalized: 'ridge_gourd', label: 'Ridge Gourd' },
  'spong gourd': { normalized: 'sponge_gourd', label: 'Sponge Gourd' },
  'sponge gourd': { normalized: 'sponge_gourd', label: 'Sponge Gourd' },
  'lufa gourd leaf': { normalized: 'luffa_gourd_leaf', label: 'Luffa Gourd Leaf' },
  'long eggplants': { normalized: 'long_eggplant', label: 'Long Eggplant' },
  'round eggplants': { normalized: 'round_eggplant', label: 'Round Eggplant' },
  'tomatoes': { normalized: 'tomato', label: 'Tomato' },
  'green papaya': { normalized: 'green_papaya', label: 'Green Papaya' },
  'long bean': { normalized: 'long_bean', label: 'Long Bean' },
  'banana flower': { normalized: 'banana_flower', label: 'Banana Flower' },
  'cauliflower': { normalized: 'cauliflower', label: 'Cauliflower' },
  'chinese kale': { normalized: 'chinese_kale', label: 'Chinese Kale' },
  'orange-flesh sweet potatoes': { normalized: 'orange_flesh_sweet_potato', label: 'Orange-Flesh Sweet Potato' },
  'orange flesh sweet potatoes': { normalized: 'orange_flesh_sweet_potato', label: 'Orange-Flesh Sweet Potato' },
  'garlic': { normalized: 'garlic', label: 'Garlic' },
  'ripe tamarind (with seed)': { normalized: 'ripe_tamarind_with_seed', label: 'Ripe Tamarind (With Seed)' },
  'ripe tamarind (no seed)': { normalized: 'ripe_tamarind_no_seed', label: 'Ripe Tamarind (No Seed)' },
  'water lily': { normalized: 'water_lily', label: 'Water Lily' },
  'climbing wattle': { normalized: 'climbing_wattle', label: 'Climbing Wattle' },
  'agati': { normalized: 'agati', label: 'Agati' },
  'abalone mushroom': { normalized: 'abalone_mushroom', label: 'Abalone Mushroom' },
  'cabbage': { normalized: 'cabbage', label: 'Cabbage' },
  'chinese salad': { normalized: 'chinese_salad', label: 'Chinese Salad' },
  'bean sprout': { normalized: 'bean_sprout', label: 'Bean Sprout' },
  'baby watermelon': { normalized: 'baby_watermelon', label: 'Baby Watermelon' },
  'okra': { normalized: 'okra', label: 'Okra' },
  'baby corn': { normalized: 'baby_corn', label: 'Baby Corn' },
  'corn': { normalized: 'corn', label: 'Corn' },
  'palm fruit (sliced)': { normalized: 'palm_fruit_sliced', label: 'Palm Fruit (Sliced)' },
  'cucumber': { normalized: 'cucumber', label: 'Cucumber' },
  'taro': { normalized: 'taro', label: 'Taro' },
  'chinese radish': { normalized: 'chinese_radish', label: 'Chinese Radish' },
  'bamboo shoot': { normalized: 'bamboo_shoot', label: 'Bamboo Shoot' },

  // Fruit and drinks
  'ripe banana': { normalized: 'ripe_banana', label: 'Ripe Banana' },
  'ripe mango': { normalized: 'ripe_mango', label: 'Ripe Mango' },
  'pineapple/anana': { normalized: 'pineapple', label: 'Pineapple' },
  'pineapple': { normalized: 'pineapple', label: 'Pineapple' },
  'fresh milk': { normalized: 'fresh_milk', label: 'Fresh Milk' },
  'coke': { normalized: 'coke', label: 'Coke' },
}

/**
 * Unit mapping. `perQuantity` records how many base units the packaging holds, so that a
 * "10 pcs" egg price and a "5 L" oil price stay comparable to their per-unit neighbours
 * downstream. We store the price exactly as printed and never divide it here - rewriting
 * a price to a per-unit basis would make price_khr disagree with the source PDF, which is
 * precisely what a reviewer is checking.
 */
export interface UnitDefinition {
  normalized: string
  perQuantity: number
}

export const UNIT_MAP: Record<string, UnitDefinition> = {
  'kg': { normalized: 'kg', perQuantity: 1 },
  'kgs': { normalized: 'kg', perQuantity: 1 },
  'kilogram': { normalized: 'kg', perQuantity: 1 },
  'g': { normalized: 'g', perQuantity: 1 },
  'l': { normalized: 'litre', perQuantity: 1 },
  'litre': { normalized: 'litre', perQuantity: 1 },
  'liter': { normalized: 'litre', perQuantity: 1 },
  '1l': { normalized: 'litre', perQuantity: 1 },
  '5l': { normalized: 'litre', perQuantity: 5 },
  '10 pcs': { normalized: 'piece', perQuantity: 10 },
  '10pcs': { normalized: 'piece', perQuantity: 10 },
  '30 pcs': { normalized: 'piece', perQuantity: 30 },
  'pcs': { normalized: 'piece', perQuantity: 1 },
  'piece': { normalized: 'piece', perQuantity: 1 },
  '140 ml': { normalized: 'ml', perQuantity: 140 },
  '330 ml': { normalized: 'ml', perQuantity: 330 },
  '730 ml': { normalized: 'ml', perQuantity: 730 },
  'ml': { normalized: 'ml', perQuantity: 1 },
}

/** Recorded verbatim on skipped rows so the run summary explains itself. */
export const NON_FOOD_SKIP_REASON =
  'non-food commodity (fuel or fertilizer) excluded from the food-price dataset'
