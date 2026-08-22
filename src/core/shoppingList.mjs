import { makeFraction, mul, div, add } from "./fraction.mjs";
import {
  DIMENSION,
  getUnit,
  registerCountUnit,
  dimensionOf,
  convert,
  lookupDensity,
} from "./units.mjs";
import { normalizeIngredientName } from "./names.mjs";
import { pickDisplayUnit } from "./format.mjs";

export const SECTIONS_ORDER = Object.freeze([
  "Produce",
  "Bakery",
  "Dairy & chilled",
  "Meat & fish",
  "Frozen",
  "Pantry",
  "Spices & baking",
  "Other",
]);

export const DEFAULT_STAPLES = Object.freeze([
  "salt",
  "black pepper",
  "olive oil",
  "vegetable oil",
  "butter",
  "flour",
  "granulated sugar",
  "water",
]);

const KEPT_SEPARATE_NOTE = "kept separate: different units with no reliable conversion";
const NO_QUANTITY_NOTE = "no quantity stated in source recipe";

function compilePatterns(phrases) {
  return phrases.map(
    (p) => new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b")
  );
}

function anyMatch(patterns, texts) {
  return patterns.some((re) => texts.some((t) => re.test(t)));
}

const FROZEN_PATTERNS = compilePatterns(["frozen", "ice cream", "ice lolly"]);

const PANTRY_OVERRIDE_PATTERNS = compilePatterns([
  "stock", "broth", "coconut milk", "peanut butter", "butter bean", "butterbean",
  "fish sauce", "soy sauce", "worcestershire", "kidney bean", "cannellini",
  "borlotti", "haricot", "black-eyed bean", "tomato paste", "tomato puree",
  "sun-dried tomato", "breadcrumb", "bread crumb", "tinned", "canned",
]);

const PRODUCE_OVERRIDE_PATTERNS = compilePatterns([
  "bell pepper", "sweet pepper", "green bean", "runner bean", "string bean",
  "french bean", "lettuce", "bean sprout",
]);

const MEAT_PATTERNS = compilePatterns([
  "chicken", "beef", "pork", "bacon", "sausage", "fish", "salmon", "tuna",
  "prawn", "shrimp", "lamb", "turkey", "duck", "venison", "rabbit", "mince",
  "meatball", "steak", "ham", "chorizo", "salami", "prosciutto", "pancetta",
  "cod", "haddock", "mackerel", "sardine", "trout", "sea bass", "crab",
  "lobster", "mussel", "clam", "squid", "anchovy", "liver",
]);

const DAIRY_PATTERNS = compilePatterns([
  "milk", "butter", "cheese", "cream", "egg", "yogurt", "yoghurt", "cheddar",
  "mozzarella", "parmesan", "parmigiano", "feta", "halloumi", "mascarpone",
  "ricotta", "brie", "camembert", "gouda", "emmental", "gruyere",
  "creme fraiche", "kefir", "margarine", "ghee", "custard", "tofu",
]);

const BAKERY_PATTERNS = compilePatterns([
  "bread", "bun", "brioche", "roll", "tortilla", "pita", "pitta", "naan",
  "bagel", "baguette", "ciabatta", "focaccia", "chapati", "flatbread",
  "sourdough", "crumpet", "muffin", "scone", "croissant",
]);

const PRODUCE_PATTERNS = compilePatterns([
  "onion", "garlic", "shallot", "leek", "carrot", "parsnip", "turnip",
  "beetroot", "beet", "swede", "rutabaga", "celeriac", "celery", "radish",
  "potato", "tomato", "cucumber", "spinach", "kale", "chard", "cabbage",
  "sprout", "broccoli", "cauliflower", "courgette", "zucchini", "aubergine",
  "eggplant", "pea", "sweetcorn", "corn", "pumpkin", "squash", "capsicum",
  "mushroom", "avocado", "apple", "pear", "banana", "orange", "lemon",
  "lime", "grapefruit", "mandarin", "clementine", "pineapple", "mango",
  "papaya", "melon", "watermelon", "peach", "nectarine", "apricot", "plum",
  "cherry", "berry", "strawberry", "raspberry", "blueberry", "blackberry",
  "cranberry", "currant", "grape", "kiwi", "fig", "ginger", "chive",
  "parsley", "basil", "coriander", "cilantro", "mint", "dill", "tarragon",
  "sage", "rosemary", "thyme", "rocket", "arugula", "watercress", "fennel",
  "artichoke", "asparagus", "okra", "endive", "rhubarb", "yam", "cassava",
  "plantain",
]);

const SPICES_PATTERNS = compilePatterns([
  "paprika", "cumin", "turmeric", "cinnamon", "cardamom", "cardamon",
  "nutmeg", "allspice", "cayenne", "chili", "chilli", "chile",
  "curry powder", "garam masala", "mixed spice", "five spice", "saffron",
  "oregano", "marjoram", "mixed herbs", "herbes de provence", "bay leaf",
  "vanilla", "baking powder", "baking soda", "bicarbonate", "bicarb",
  "yeast", "cornflour", "cornstarch", "salt", "pepper", "peppercorn",
  "sugar", "cocoa", "xanthan",
]);

const PANTRY_PATTERNS = compilePatterns([
  "flour", "rice", "pasta", "spaghetti", "macaroni", "penne", "fusilli",
  "farfalle", "linguine", "tagliatelle", "lasagne", "lasagna", "noodle",
  "ramen", "udon", "soba", "couscous", "quinoa", "bulgur", "barley",
  "semolina", "polenta", "lentil", "dal", "oat", "porridge", "cereal",
  "bran", "bean", "chickpea", "tahini", "passata", "salsa", "oil",
  "vinegar", "honey", "syrup", "molasses", "treacle", "jam", "marmalade",
  "chutney", "pickle", "relish", "ketchup", "mustard", "mayonnaise",
  "mayo", "sriracha", "tabasco", "wasabi", "coffee", "tea", "biscuit",
  "cracker", "marshmallow", "coconut", "peanut", "cashew", "walnut",
  "pecan", "pistachio", "hazelnut", "macadamia",
]);

export function classifySection(itemName) {
  if (typeof itemName !== "string" || !itemName.trim()) return "Other";
  const raw = itemName.toLowerCase();
  const norm = normalizeIngredientName(itemName) || raw;
  const texts = raw === norm ? [raw] : [raw, norm];
  if (anyMatch(FROZEN_PATTERNS, texts)) return "Frozen";
  if (anyMatch(PANTRY_OVERRIDE_PATTERNS, texts)) return "Pantry";
  if (anyMatch(PRODUCE_OVERRIDE_PATTERNS, texts)) return "Produce";
  if (anyMatch(MEAT_PATTERNS, texts)) return "Meat & fish";
  if (anyMatch(DAIRY_PATTERNS, texts)) return "Dairy & chilled";
  if (anyMatch(BAKERY_PATTERNS, texts)) return "Bakery";
  if (anyMatch(PRODUCE_PATTERNS, texts)) return "Produce";
  if (anyMatch(SPICES_PATTERNS, texts)) return "Spices & baking";
  if (anyMatch(PANTRY_PATTERNS, texts)) return "Pantry";
  return "Other";
}

function isFractionLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isInteger(value.n) &&
    Number.isInteger(value.d)
  );
}

function toFraction(value) {
  return isFractionLike(value) ? value : makeFraction(value);
}

export function scaleFactor(serves, servings) {
  if (servings == null || serves == null) return makeFraction(1);
  const denominator = toFraction(serves);
  if (denominator.n === 0) return makeFraction(1);
  return div(toFraction(servings), denominator);
}

function displayEntry(amount, baseUnitId, system, approx) {
  const picked = pickDisplayUnit(amount, baseUnitId, { system });
  return { amount: picked.amount, unit: picked.unitId, approx };
}

export function mergeQuantities(entries, { system = null, density = null } = {}) {
  let volumeMl = makeFraction(0);
  let massG = makeFraction(0);
  let hasVolume = false;
  let hasMass = false;
  const counts = new Map();

  for (const entry of entries || []) {
    const unitId = String(entry.unit);
    if (!getUnit(unitId)) registerCountUnit(unitId);
    const dim = dimensionOf(unitId);
    if (dim === DIMENSION.VOLUME) {
      volumeMl = add(volumeMl, convert(entry.amount, unitId, "ml"));
      hasVolume = true;
    } else if (dim === DIMENSION.MASS) {
      massG = add(massG, convert(entry.amount, unitId, "g"));
      hasMass = true;
    } else {
      counts.set(
        unitId,
        counts.has(unitId) ? add(counts.get(unitId), entry.amount) : entry.amount
      );
    }
  }

  const quantities = [];
  const notes = [];

  for (const [unitId, amount] of counts) {
    quantities.push({ amount, unit: unitId, approx: false });
  }
  if (counts.size >= 2 || (counts.size >= 1 && (hasVolume || hasMass))) {
    notes.push(KEPT_SEPARATE_NOTE);
  }

  let massApprox = false;
  if (hasVolume && hasMass && density) {
    massG = add(massG, mul(volumeMl, density));
    hasVolume = false;
    massApprox = true;
  } else if (hasVolume && hasMass) {
    notes.push(KEPT_SEPARATE_NOTE);
  }

  if (hasVolume) quantities.push(displayEntry(volumeMl, "ml", system, false));
  if (hasMass) quantities.push(displayEntry(massG, "g", system, massApprox));

  return { quantities, notes: [...new Set(notes)], approx: massApprox };
}

function createAccumulator(key) {
  return {
    key,
    wordings: new Map(),
    recipeIds: [],
    preparations: [],
    preparationKeys: new Set(),
    scaled: [],
    unquantified: false,
    sectionOverride: null,
  };
}

function recordWording(acc, wording) {
  const existing = acc.wordings.get(wording);
  if (existing) existing.count += 1;
  else acc.wordings.set(wording, { count: 1 });
}

function selectDisplayName(acc) {
  let best = null;
  for (const [wording, info] of acc.wordings) {
    if (!best || info.count > best.count) best = { wording, count: info.count };
  }
  return best ? best.wording : acc.key;
}

function isValidSystem(system) {
  return system === null || system === "metric" || system === "imperial";
}

export function buildShoppingList(inputs, opts = {}) {
  const excludeStaples = opts.excludeStaples === true;
  const staples = Array.isArray(opts.staples) ? opts.staples : DEFAULT_STAPLES;
  const system = opts.system ?? null;
  if (!isValidSystem(system)) {
    throw new Error("unsupported unit system: " + String(opts.system));
  }

  const stapleKeys = new Set();
  for (const staple of staples) {
    const key = normalizeIngredientName(staple);
    if (key) stapleKeys.add(key);
  }
  const hiddenNames = new Set();

  const groups = new Map();
  for (const input of inputs || []) {
    const recipe = input && input.recipe;
    if (!recipe) continue;
    const factor = scaleFactor(
      recipe.yield ? recipe.yield.serves : null,
      input.servings
    );
    for (const line of recipe.ingredients || []) {
      const key = normalizeIngredientName(line.item);
      if (!key) continue;
      if (excludeStaples && stapleKeys.has(key)) {
        hiddenNames.add(key);
        continue;
      }
      let acc = groups.get(key);
      if (!acc) {
        acc = createAccumulator(key);
        groups.set(key, acc);
      }
      if (recipe.id && !acc.recipeIds.includes(recipe.id)) {
        acc.recipeIds.push(recipe.id);
      }
      if (typeof line.item === "string" && line.item.trim()) {
        recordWording(acc, line.item.trim());
      }
      const preparation =
        typeof line.preparation === "string" ? line.preparation.trim() : "";
      if (preparation && !acc.preparationKeys.has(preparation.toLowerCase())) {
        acc.preparationKeys.add(preparation.toLowerCase());
        acc.preparations.push(preparation);
      }
      if (
        !acc.sectionOverride &&
        line.sectionOverride &&
        SECTIONS_ORDER.includes(line.sectionOverride)
      ) {
        acc.sectionOverride = line.sectionOverride;
      }
      if (line.quantity && line.unit) {
        acc.scaled.push({ amount: mul(line.quantity, factor), unit: line.unit });
      } else {
        acc.unquantified = true;
      }
    }
  }

  const sectionBuckets = new Map();
  for (const acc of groups.values()) {
    const densityInfo = lookupDensity(acc.key);
    const merged = mergeQuantities(acc.scaled, {
      system,
      density: densityInfo ? densityInfo.density : null,
    });
    const notes = merged.notes.slice();
    if (acc.preparations.length >= 2) {
      notes.push("different preparations: " + acc.preparations.join(" / "));
    }
    if (merged.quantities.length === 0 && acc.unquantified) {
      merged.quantities.push({ amount: null, unit: null, approx: false });
      notes.push(NO_QUANTITY_NOTE);
    }
    const item = {
      key: acc.key,
      displayName: selectDisplayName(acc),
      quantities: merged.quantities,
      preparations: acc.preparations,
      recipeIds: acc.recipeIds,
      notes,
    };
    const section = acc.sectionOverride || classifySection(acc.key);
    let bucket = sectionBuckets.get(section);
    if (!bucket) {
      bucket = [];
      sectionBuckets.set(section, bucket);
    }
    bucket.push(item);
  }

  const outGroups = [];
  for (const section of SECTIONS_ORDER) {
    const bucket = sectionBuckets.get(section);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort((a, b) =>
      a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0
    );
    outGroups.push({ section, items: bucket });
  }

  return {
    groups: outGroups,
    hiddenStaples: hiddenNames.size,
    sectionsOrder: SECTIONS_ORDER,
  };
}
