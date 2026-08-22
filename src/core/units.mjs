// units.mjs — the unit registry. Single source of truth for dimensions,
// conversion factors and aliases. All factors are exact rationals.
//
// VOLUME CONVENTION (documented in README): Panfare uses kitchen-standard
// metric spoons and cups so that every volume conversion stays exact:
//   1 tsp = 5 ml · 1 tbsp = 15 ml · 1 fl oz = 30 ml
//   1 cup = 240 ml · 1 pint = 480 ml · 1 quart = 960 ml · 1 gallon = 3840 ml
// MASS uses exact international avoirdupois definitions:
//   1 lb = 453.59237 g (exact) · 1 oz = lb / 16

import { makeFraction, mul, div } from "./fraction.mjs";

export const DIMENSION = Object.freeze({
  VOLUME: "volume",
  MASS: "mass",
  COUNT: "count",
});

function def(id, dim, factorN, factorD, system, label, aliases) {
  return { id, dim, factor: makeFraction(factorN, factorD), system, label, aliases };
}

// prettier-ignore
export const UNITS = Object.freeze({
  // volume (base: ml)
  ml:     def("ml", DIMENSION.VOLUME, 1, 1, "metric", "ml", ["millilitre", "millilitres", "milliliter", "milliliters"]),
  l:      def("l", DIMENSION.VOLUME, 1000, 1, "metric", "l", ["litre", "litres", "liter", "liters"]),
  tsp:    def("tsp", DIMENSION.VOLUME, 5, 1, "imperial", "tsp", ["teaspoon", "teaspoons", "tsps", "tspns"]),
  tbsp:   def("tbsp", DIMENSION.VOLUME, 15, 1, "imperial", "tbsp", ["tablespoon", "tablespoons", "tbsps", "tblsp", "tblsps"]),
  floz:   def("floz", DIMENSION.VOLUME, 30, 1, "imperial", "fl oz", ["fluid ounce", "fluid ounces", "fl oz", "fl. oz", "fluid oz"]),
  cup:    def("cup", DIMENSION.VOLUME, 240, 1, "imperial", "cup", ["cups"]),
  pint:   def("pint", DIMENSION.VOLUME, 480, 1, "imperial", "pint", ["pints"]),
  quart:  def("quart", DIMENSION.VOLUME, 960, 1, "imperial", "quart", ["quarts", "qt"]),
  gallon: def("gallon", DIMENSION.VOLUME, 3840, 1, "imperial", "gallon", ["gallons", "gal"]),

  // mass (base: g)
  mg: def("mg", DIMENSION.MASS, 1, 1000, "metric", "mg", ["milligram", "milligrams"]),
  g:  def("g", DIMENSION.MASS, 1, 1, "metric", "g", ["gram", "grams", "gramme", "grammes"]),
  kg: def("kg", DIMENSION.MASS, 1000, 1, "metric", "kg", ["kilogram", "kilograms", "kilos", "kilo"]),
  oz: def("oz", DIMENSION.MASS, 45359237, 1600000, "imperial", "oz", ["ounce", "ounces"]),
  lb: def("lb", DIMENSION.MASS, 45359237, 100000, "imperial", "lb", ["lbs", "pound", "pounds"]),

  // count (dimensionless amounts of a named thing; never cross-converted)
  each:   def("each", DIMENSION.COUNT, 1, 1, "count", "", []),
  clove:  def("clove", DIMENSION.COUNT, 1, 1, "count", "clove", ["cloves"]),
  slice:  def("slice", DIMENSION.COUNT, 1, 1, "count", "slice", ["slices"]),
  sprig:  def("sprig", DIMENSION.COUNT, 1, 1, "count", "sprig", ["sprigs"]),
  leaf:   def("leaf", DIMENSION.COUNT, 1, 1, "count", "leaf", ["leaves"]),
  stick:  def("stick", DIMENSION.COUNT, 1, 1, "count", "stick", ["sticks"]),
  can:    def("can", DIMENSION.COUNT, 1, 1, "count", "can", ["cans", "tin", "tins"]),
  packet: def("packet", DIMENSION.COUNT, 1, 1, "count", "packet", ["packets", "pack", "packs", "envelope", "envelopes", "sachet", "sachets"]),
  bunch:  def("bunch", DIMENSION.COUNT, 1, 1, "count", "bunch", ["bunches"]),
  head:   def("head", DIMENSION.COUNT, 1, 1, "count", "head", ["heads"]),
  fillet: def("fillet", DIMENSION.COUNT, 1, 1, "count", "fillet", ["fillets"]),
  rasher: def("rasher", DIMENSION.COUNT, 1, 1, "count", "rasher", ["rashers"]),
  pinch:  def("pinch", DIMENSION.COUNT, 1, 1, "count", "pinch", ["pinches"]),
  dash:   def("dash", DIMENSION.COUNT, 1, 1, "count", "dash", ["dashes"]),
  handful: def("handful", DIMENSION.COUNT, 1, 1, "count", "handful", ["handfuls"]),
});

const ALIAS_TO_ID = new Map();
for (const unit of Object.values(UNITS)) {
  ALIAS_TO_ID.set(unit.id, unit.id);
  ALIAS_TO_ID.set(unit.label, unit.id);
  for (const alias of unit.aliases) {
    ALIAS_TO_ID.set(alias.toLowerCase(), unit.id);
  }
}

/**
 * Resolve a unit token as written by a human ("Cups", "fluid ounce")
 * to its canonical unit id, or null when unknown.
 */
export function resolveUnit(token) {
  if (!token) return null;
  return ALIAS_TO_ID.get(String(token).trim().toLowerCase()) || null;
}

const EXTRA_COUNT_UNITS = new Map();

/**
 * Register an ad-hoc countable unit found while parsing ("wedge", "strip").
 * Countables are never convertible to anything but themselves.
 */
export function registerCountUnit(word) {
  const id = String(word).trim().toLowerCase();
  if (!id) return null;
  if (UNITS[id] || EXTRA_COUNT_UNITS.has(id)) return id;
  EXTRA_COUNT_UNITS.set(id, def(id, DIMENSION.COUNT, 1, 1, "count", id, []));
  return id;
}

export function getUnit(id) {
  return UNITS[id] || EXTRA_COUNT_UNITS.get(id) || null;
}

export function dimensionOf(unitId) {
  const unit = getUnit(unitId);
  if (!unit) throw new Error("unknown unit id: " + unitId);
  return unit.dim;
}

export function sameDimension(aId, bId) {
  return dimensionOf(aId) === dimensionOf(bId);
}

/**
 * Exact conversion between two units of the same dimension.
 * Returns a Fraction. Throws when the dimensions differ — callers decide
 * whether a density-based path applies before calling.
 */
export function convert(amount, fromId, toId) {
  const from = getUnit(fromId);
  const to = getUnit(toId);
  if (!from) throw new Error("unknown unit id: " + fromId);
  if (!to) throw new Error("unknown unit id: " + toId);
  if (from.dim !== to.dim) {
    throw new Error(
      "cannot convert " + fromId + " (" + from.dim + ") to " + toId + " (" + to.dim + ")"
    );
  }
  if (from.dim === DIMENSION.COUNT && from.id !== to.id) {
    throw new Error(
      "cannot convert between different countable units: " + fromId + " -> " + toId
    );
  }
  if (from.id === to.id) return amount;
  return div(mul(amount, from.factor), to.factor);
}

/**
 * Non-throwing variant used where refusal must be graceful.
 * -> { ok: true, value } | { ok: false, reason }
 */
export function tryConvert(amount, fromId, toId) {
  try {
    const from = getUnit(fromId);
    const to = getUnit(toId);
    if (!from || !to) return { ok: false, reason: "unknown-unit" };
    if (from.dim !== to.dim) return { ok: false, reason: "different-dimension" };
    return { ok: true, value: convert(amount, fromId, toId) };
  } catch (err) {
    return { ok: false, reason: String(err && err.message || err) };
  }
}

/**
 * Volume-to-mass or mass-to-volume conversion using a known density
 * (grams per millilitre). Refuses anything else.
 * -> { ok: true, value } | { ok: false, reason }
 */
export function convertWithDensity(amount, fromId, toId, densityGPerMl) {
  const from = getUnit(fromId);
  const to = getUnit(toId);
  if (!from || !to) return { ok: false, reason: "unknown-unit" };
  if (!densityGPerMl) return { ok: false, reason: "no-density-known" };
  if (from.dim === DIMENSION.VOLUME && to.dim === DIMENSION.MASS) {
    const grams = mul(convert(amount, fromId, "ml"), densityGPerMl);
    return { ok: true, value: convert(grams, "g", toId) };
  }
  if (from.dim === DIMENSION.MASS && to.dim === DIMENSION.VOLUME) {
    const mls = div(convert(amount, fromId, "g"), densityGPerMl);
    return { ok: true, value: convert(mls, "ml", toId) };
  }
  return { ok: false, reason: "not-a-volume-mass-pair" };
}

/**
 * Approximate densities (g per ml) for ingredients Panfare knows.
 * These are cooking approximations, not lab values; every conversion made
 * with them is displayed with an explicit "approx" marker by the formatter.
 */
export const DENSITIES = Object.freeze({
  water: { density: makeFraction(100, 100), note: "also treated for stock and broth" },
  stock: { density: makeFraction(100, 100), note: "" },
  milk: { density: makeFraction(103, 100), note: "" },
  cream: { density: makeFraction(99, 100), note: "single, double or heavy" },
  yogurt: { density: makeFraction(104, 100), note: "" },
  "sour cream": { density: makeFraction(101, 100), note: "" },
  oil: { density: makeFraction(91, 100), note: "vegetable, olive, sunflower" },
  butter: { density: makeFraction(96, 100), note: "" },
  honey: { density: makeFraction(142, 100), note: "" },
  "maple syrup": { density: makeFraction(132, 100), note: "" },
  "golden syrup": { density: makeFraction(142, 100), note: "" },
  sugar: { density: makeFraction(85, 100), note: "granulated" },
  "caster sugar": { density: makeFraction(88, 100), note: "" },
  "brown sugar": { density: makeFraction(90, 100), note: "packed" },
  "icing sugar": { density: makeFraction(56, 100), note: "also called powdered sugar" },
  flour: { density: makeFraction(55, 100), note: "scooped approximation; weigh flour for baking" },
  cocoa: { density: makeFraction(45, 100), note: "cocoa powder" },
  salt: { density: makeFraction(120, 100), note: "fine table salt; flakes differ" },
  rice: { density: makeFraction(85, 100), note: "uncooked white rice" },
  oats: { density: makeFraction(40, 100), note: "rolled oats" },
  "ground almonds": { density: makeFraction(45, 100), note: "almond meal/flour" },
  "peanut butter": { density: makeFraction(108, 100), note: "" },
  wine: { density: makeFraction(99, 100), note: "" },
  vinegar: { density: makeFraction(101, 100), note: "" },
  "orange juice": { density: makeFraction(104, 100), note: "" },
});

/** Lookup density for an already-normalised (lowercase, singular) name. */
export function lookupDensity(normalizedName) {
  if (!normalizedName) return null;
  const direct = DENSITIES[normalizedName];
  if (direct) return direct;
  // fall back to the last word or two ("plain flour" -> "flour")
  const words = normalizedName.split(/\s+/);
  if (words.length > 1) {
    const tail = words.slice(-2).join(" ");
    if (DENSITIES[tail]) return DENSITIES[tail];
    const last = words[words.length - 1];
    if (DENSITIES[last]) return DENSITIES[last];
  }
  return null;
}
