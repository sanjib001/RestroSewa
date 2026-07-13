// The veg / egg / non-veg mark is a food-safety signal, not decoration: a guest
// scanning a menu reads the COLOUR before the word. It has to mean the same thing
// on the admin menu editor, the POS, and the customer's phone — so the palette
// lives here once rather than being re-declared per screen (it previously was,
// three times, with three different sets of hexes).
//
// Egg is deliberately GOLD, not amber. It used to be #d97706, which sits a few
// degrees of hue from the non-veg red and is indistinguishable in a 13px dot —
// exactly the two marks a guest can least afford to confuse. #ca8a04 reads
// unmistakably yellow while still clearing the 3:1 contrast floor for non-text
// UI on white; a lighter yellow (#eab308) would look right and fail that.

export type FoodType = "veg" | "non_veg" | "vegan" | "egg";

export const FOOD_TYPES: Record<
  FoodType,
  { label: string; color: string; soft: string }
> = {
  veg:     { label: "Veg",     color: "#16a34a", soft: "#f0fdf4" },
  egg:     { label: "Egg",     color: "#ca8a04", soft: "#fefce8" },
  non_veg: { label: "Non-Veg", color: "#dc2626", soft: "#fef2f2" },
  vegan:   { label: "Vegan",   color: "#0d9488", soft: "#f0fdfa" },
};

// Presentation order — the order these appear in every picker. Veg first, then
// egg, then non-veg, mirrors how Indian menus are conventionally read.
export const FOOD_TYPE_KEYS: FoodType[] = ["veg", "egg", "non_veg", "vegan"];

export function foodType(type: string | null | undefined) {
  return FOOD_TYPES[(type as FoodType) ?? "veg"] ?? FOOD_TYPES.veg;
}
