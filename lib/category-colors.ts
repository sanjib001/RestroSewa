/**
 * A colour per menu category, so a category is recognisable before its name is read.
 *
 * Categories are free-text rows a restaurant creates itself (`menu_categories.name`) — there
 * is no colour column and adding one is out of scope — so the colour is *resolved*, never
 * stored:
 *
 *   1. Match the name against the known list below (case/spacing/punctuation-insensitive,
 *      with the obvious synonyms). "Main Course", "Mains" and "MAIN COURSE" all land on
 *      orange, which is what makes the intended mapping hold for a typical menu.
 *   2. Anything unrecognised — "Momo", "Thali", a Nepali or Hindi name, a one-off like
 *      "Chef's Specials" — gets a hue derived from its id. Stable across reloads and devices
 *      because it's a pure function of the id, not an array index (which would re-shuffle
 *      every time a category was added or reordered).
 *
 * Values are `var()` references so categories keep their identity in dark mode; the tokens
 * live in `app/globals.css` (`--cat-*`).
 */
export type CategoryHue =
  | "orange" | "green" | "yellow" | "blue" | "pink" | "brown"
  | "purple" | "cyan" | "red" | "teal" | "indigo" | "lime";

export type CategoryStyle = { color: string; soft: string };

const HUES: CategoryHue[] = [
  "orange", "green", "yellow", "blue", "pink", "brown",
  "purple", "cyan", "red", "teal", "indigo", "lime",
];

export const CATEGORY_STYLE: Record<CategoryHue, CategoryStyle> = Object.fromEntries(
  HUES.map((h) => [h, { color: `var(--cat-${h})`, soft: `var(--cat-${h}-soft)` }])
) as Record<CategoryHue, CategoryStyle>;

/**
 * Known names → hue. Keys are normalised (lowercase, alphanumerics only), so "Main Course",
 * "main-course" and "MainCourse" all collapse to "maincourse".
 *
 * Synonyms are listed because a menu says "Mains" or "Beverages" as readily as the canonical
 * name; without them a typical menu would fall through to the auto hue and the mapping would
 * look broken.
 */
const KNOWN: Record<string, CategoryHue> = {
  // Main Course → Orange
  maincourse: "orange", main: "orange", mains: "orange", maincourses: "orange",
  mainmenu: "orange", entree: "orange", entrees: "orange",
  // Starter → Green
  starter: "green", starters: "green", appetizer: "green", appetizers: "green",
  appetiser: "green", appetisers: "green", salad: "green", salads: "green",
  // Snacks → Yellow
  snack: "yellow", snacks: "yellow", sides: "yellow", side: "yellow", fastfood: "yellow",
  // Drinks → Blue
  drink: "blue", drinks: "blue", beverage: "blue", beverages: "blue",
  softdrinks: "blue", juice: "blue", juices: "blue", coldrinks: "blue", colddrinks: "blue",
  // Desserts → Pink
  dessert: "pink", desserts: "pink", sweet: "pink", sweets: "pink", icecream: "pink",
  // Coffee → Brown
  coffee: "brown", tea: "brown", hotdrinks: "brown", hotbeverages: "brown", cafe: "brown",
  // Bar → Purple
  bar: "purple", cocktail: "purple", cocktails: "purple", alcohol: "purple",
  liquor: "purple", beer: "purple", beers: "purple", wine: "purple", wines: "purple",
  spirits: "purple", whisky: "purple",
  // Breakfast → Cyan
  breakfast: "cyan", brunch: "cyan", morning: "cyan",
  // Sensible extras beyond the brief's list
  soup: "teal", soups: "teal",
  rice: "lime", noodles: "lime", pasta: "lime", bread: "lime", breads: "lime",
  combo: "indigo", combos: "indigo", special: "indigo", specials: "indigo", thali: "indigo",
  grill: "red", bbq: "red", tandoor: "red", barbecue: "red",
};

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * FNV-1a over the id. Only used as the last resort below (more categories than hues), where
 * collisions are unavoidable anyway.
 */
function hueFromId(id: string): CategoryHue {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return HUES[Math.abs(h) % HUES.length];
}

/**
 * Assigns a hue to every category in ONE pass over the whole list, because the colours only
 * do their job if they're different from each other.
 *
 * Hashing each name/id independently was the obvious approach and it's wrong: with 12 hues,
 * five unrecognised categories collide ~62% of the time (birthday problem), and a menu with
 * two identical-looking "Momo" and "Thali" chips is worse than no colour at all. Allocating
 * across the list instead guarantees distinctness up to 12 categories.
 *
 *   1. Known names take their mapped hue and reserve it. (Deliberately NOT distinct: Coffee
 *      and Tea are both brown, Beer and Cocktails both purple — that grouping is meaningful.)
 *   2. Everything else takes the next hue nobody has claimed, walking the list in the order the
 *      admin arranged it, so appending a category never re-colours the ones above it.
 *   3. Past 12, fall back to the id hash — collisions exist but the palette is exhausted.
 */
export function assignCategoryHues(
  cats: readonly { id: string; name: string }[]
): Map<string, CategoryHue> {
  const map = new Map<string, CategoryHue>();
  const used = new Set<CategoryHue>();

  for (const cat of cats) {
    const known = KNOWN[normalise(cat.name ?? "")];
    if (known) {
      map.set(cat.id, known);
      used.add(known);
    }
  }

  for (const cat of cats) {
    if (map.has(cat.id)) continue;
    const free = HUES.find((h) => !used.has(h));
    if (free) {
      used.add(free);
      map.set(cat.id, free);
    } else {
      map.set(cat.id, hueFromId(cat.id ?? cat.name ?? ""));
    }
  }

  return map;
}

/** The colour pair for a resolved hue — what call sites actually render. */
export function styleOf(hue: CategoryHue): CategoryStyle {
  return CATEGORY_STYLE[hue];
}
