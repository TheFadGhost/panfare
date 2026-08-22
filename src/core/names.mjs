// names.mjs — ingredient name normalisation, shared by the parser,
// the shopping-list merge engine and density lookups.
//
// Normalised names are lowercase, singular, punctuation-light strings used
// for identity ("free-range eggs" and "eggs" meet as "egg"). Display text
// is never replaced — callers keep the original wording on the record.

const IRREGULAR_SINGULARS = new Map([
  ["leaves", "leaf"],
  ["loaves", "loaf"],
  ["halves", "half"],
  ["knives", "knife"],
  ["tomatoes", "tomato"],
  ["potatoes", "potato"],
  ["mangoes", "mango"],
  ["radishes", "radish"],
  ["squashes", "squash"],
  ["peaches", "peach"],
  ["anchovies", "anchovy"],
  ["cherries", "cherry"],
  ["berries", "berry"],
  ["chillies", "chilli"],
  ["chilies", "chili"],
  ["spice", "spice"],
]);

// Regional synonyms collapse to one canonical name (first listed wins).
const SYNONYMS = new Map([
  ["scallion", "spring onion"],
  ["cilantro", "coriander"],
  ["eggplant", "aubergine"],
  ["zucchini", "courgette"],
  ["swede", "rutabaga"],
  ["beet", "beetroot"],
  ["cider vinegar", "apple cider vinegar"],
  ["garlic powder", "garlic powder"],
]);

// Qualifier words that describe grade/size rather than identity. Stripped
// for matching only; they stay in the displayed preparation/descriptor text
// when the caller moves them there.
const QUALIFIERS = new Set([
  "fresh",
  "freshly",
  "ripe",
  "organic",
  "free-range",
  "freerange",
  "large",
  "extra-large",
  "medium",
  "small",
  "baby",
  "raw",
  "whole",
  "dried",
  "ground",
  "plain",
  "self-raising",
  "selfraising",
  "unsalted",
  "salted",
  "granulated",
  "caster",
  "icing",
  "powdered",
  "packed",
  "sifted",
]);

function singularizeWord(word) {
  if (IRREGULAR_SINGULARS.has(word)) return IRREGULAR_SINGULARS.get(word);
  if (word.length < 4) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("oes") || word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes") || word.endsWith("ches") || word.endsWith("shes")) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Canonical identity string for an ingredient item name.
 * Returns null for empty input. Never mutates or replaces display text.
 */
export function normalizeIngredientName(item) {
  if (!item || typeof item !== "string") return null;
  let s = item.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z\s-]/g, " ").trim();
  if (!s) return null;
  let words = s.split(/\s+/);
  // strip leading and trailing qualifier words for identity purposes
  words = words.filter((w) => !QUALIFIERS.has(w));
  if (words.length === 0) words = s.split(/\s+/);
  words = words.map(singularizeWord);
  const joined = words.join(" ");
  const canonical = SYNONYMS.get(joined) || joined;
  // try two-word synonym keys against the tail ("red wine" stays; handled upstream)
  return canonical || null;
}

/**
 * Split an item phrase into { core, qualifiers } where qualifiers are the
 * stripped descriptor words (display keeps both).
 */
export function splitQualifiers(item) {
  const words = String(item).split(/\s+/).filter(Boolean);
  const kept = [];
  const quals = [];
  for (const w of words) {
    if (quals.length === 0 && QUALIFIERS.has(w.toLowerCase())) quals.push(w);
    else kept.push(w);
  }
  return { core: kept.join(" "), qualifiers: quals.join(" ") };
}
