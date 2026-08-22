// parser.mjs — free-text ingredient line parser.
//
// Never drops a line and never silently guesses: anything it cannot fully
// understand comes back best-effort with uncertain=true and a reason.
// All amounts are exact Fractions; decimal strings go through
// fromDecimalString so "0.5" is stored as exactly 1/2.
//
// Documented decisions:
// - "Salt, to taste"          -> quantity null, preparation "to taste", NOT uncertain.
// - "some olive oil"          -> uncertain=true, reason "no-quantity" (vague quantifier).
// - "2 x 400 g cans tomatoes" -> quantity 2, unit "can", item keeps "(400 g can)"
//                                verbatim so the tin size never scales.
// - "juice of 1 lemon"        -> item "lemon juice", quantity 1 (the fruit count),
//                                preparation "juice of 1 lemon".

import {
  makeFraction,
  fromDecimalString,
  MalformedFractionError,
} from "./fraction.mjs";
import { resolveUnit, registerCountUnit, getUnit, DIMENSION } from "./units.mjs";

const VULGAR = new Map([
  ["\u00BD", [1, 2]], ["\u2153", [1, 3]], ["\u2154", [2, 3]],
  ["\u00BC", [1, 4]], ["\u00BE", [3, 4]], ["\u2155", [1, 5]],
  ["\u2156", [2, 5]], ["\u2157", [3, 5]], ["\u2158", [4, 5]],
  ["\u2159", [1, 6]], ["\u215A", [5, 6]], ["\u215B", [1, 8]],
  ["\u215C", [3, 8]], ["\u215D", [5, 8]], ["\u215E", [7, 8]],
]);

// Words that describe size/state and must never become count units.
const NON_UNIT_WORDS = new Set([
  "medium", "large", "small", "big", "whole", "half", "fresh", "dried",
  "frozen", "tinned", "canned", "free-range", "ripe", "raw", "cooked",
  "leftover", "extra", "plus", "about", "approx", "approximately",
]);

const PREPARATION_HINTS = [
  "chopped", "sifted", "crushed", "grated", "rinsed", "drained", "melted",
  "softened", "beaten", "sliced", "diced", "minced", "peeled", "trimmed",
  "to taste", "to serve", "for greasing", "for dusting", "for frying",
  "finely", "roughly", "thinly", "at room temperature", "plus", "optional",
  "juiced", "zested", "halved", "quartered", "shredded", "torn", "packed",
  "boiling", "cold", "warm", "toasted", "ground", "broken", "cut into",
  "picked", "separated", "washed", "cored", "skinned", "stemmed", "deboned",
];

const VAGUE_QUANTIFIERS = new Set(["some", "few", "several", "lots", "plenty", "enough"]);

// Countable-ish words that are safe to promote to units even without
// surrounding context ("2 wedges lemon"), unlike plain ingredient names
// ("2 bay leaves").
const KNOWN_ADHOC = new Set([
  "wedge", "strip", "splash", "square", "piece", "chunk", "sheet",
  "slab", "knot", "dollop", "speck", "thread",
]);

const VULGAR_CLASS = "[\u00BD\u2153\u2154\u00BC\u00BE\u2155\u2156\u2157\u2158\u2159\u215A\u215B\u215C\u215D\u215E\u2044]";
// Alternation order matters: compound forms must precede bare "\d+" so
// "1½" is not captured as just "1".
const QTY_TOKEN =
  "(?:\\d+\\s+\\d+\\s*[" + "/" + "\u2044" + "]\\s*\\d+" +          // 1 1/2
  "|\\d+\\s*[" + "/" + "\u2044" + "]\\s*\\d+" +                    // 3/4, 3⁄4
  "|\\d+\\.\\d+" +                                                 // 0.75
  "|\\d+\\s*" + VULGAR_CLASS.replace(/\u2044/, "") +               // 1½
  "|" + VULGAR_CLASS +                                             // ½
  "|\\d+" +                                                        // 2
  "|(?:a|an)(?=\\s))";                                             // a / an

function vulgarToFrac(ch) {
  const pair = VULGAR.get(ch);
  if (!pair) return null;
  return makeFraction(pair[0], pair[1]);
}

/**
 * Convert a matched numeric token ("1 1/2", "0.75", "½", "a") to a Fraction.
 * Returns null when the token cannot be understood.
 */
export function numberTokenToFraction(token) {
  const t = String(token).trim();
  if (!t) return null;
  if (/^(a|an)$/i.test(t)) return makeFraction(1);
  const mixed = /^(\d+)\s+(\d+)\s*[/⁄]\s*(\d+)$/.exec(t);
  if (mixed) {
    const whole = Number(mixed[1]);
    const part = makeFraction(Number(mixed[2]), Number(mixed[3]));
    return makeFraction(whole * part.d + part.n, part.d);
  }
  const slash = /^(\d+)\s*[/⁄]\s*(\d+)$/.exec(t);
  if (slash) return makeFraction(Number(slash[1]), Number(slash[2]));
  const dec = /^\d+\.\d+$/.test(t);
  if (dec) return fromDecimalString(t);
  if (/^\d+$/.test(t)) return makeFraction(Number(t));
  if (t.length === 1 && VULGAR.has(t)) return vulgarToFrac(t);
  // integer + vulgar glued together ("1½")
  if (t.length === 2 && VULGAR.has(t[1]) && /\d/.test(t[0])) {
    const whole = Number(t[0]);
    const part = vulgarToFrac(t[1]);
    return makeFraction(whole * part.d + part.n, part.d);
  }
  return null;
}

function looksPreparative(segment) {
  const s = segment.trim().toLowerCase();
  if (!s) return false;
  if (/^\d/.test(s)) return false;
  return PREPARATION_HINTS.some((h) => s.includes(h));
}

function splitSubstitution(text) {
  const m = /^(.*?),?\s+or\s+([^,]+)$/i.exec(text);
  if (m && !/^\s*$/.test(m[2])) {
    return { main: m[1].replace(/,\s*$/, ""), substitute: m[2].trim() };
  }
  return { main: text, substitute: null };
}

function splitPreparation(main) {
  const segments = main.split(/,/).map((s) => s.trim()).filter(Boolean);
  if (segments.length <= 1) return { core: main.trim(), preparation: null };
  const core = [segments[0]];
  const preps = [];
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (looksPreparative(seg)) preps.push(seg);
    else if (/^(?:plus|and)\s+/i.test(seg)) preps.push(seg);
    else core.push(seg);
  }
  return {
    core: core.join(", "),
    preparation: preps.length ? preps.join(", ") : null,
  };
}

// "2 x 400 g cans coconut milk" style multi-pack lines.
function matchMultiPack(core) {
  const m = /^(\d+)\s*[x\u00D7]\s*(\d+)\s*(mg|g|kg|ml|l)?\s+(.+)$/.exec(core);
  if (!m) return null;
  const count = numberTokenToFraction(m[1]);
  if (!count) return null;
  let item = m[4].replace(/^(?:cans?|tins?|packets?|packs?|jars?|bottles?)\s+/i, "");
  if (!item) return null;
  if (m[2] && m[3]) {
    item += " (" + m[2] + " " + m[3] + " can)";
  } else {
    item += " (multi-pack)";
  }
  return { quantity: count, unit: "can", item };
}

// "juice of 1 lemon" / "zest of 2 limes" descriptors.
function matchDescriptorOf(core) {
  const m = /^(?:the\s+)?(juice|zest)\s+of\s+(.+)$/i.exec(core);
  if (!m) return null;
  return { descriptor: m[1].toLowerCase(), rest: m[2] };
}

function consumeUnit(text) {
  // try longest (two-word) first: "fluid ounces", "fl oz"
  const words = text.split(/\s+/);
  if (words.length >= 2) {
    const two = (words[0] + " " + words[1]).toLowerCase();
    const twoId = resolveUnit(two);
    if (twoId) return { unitId: twoId, rest: words.slice(2).join(" ") };
  }
  const first = words[0];
  if (!first) return null;
  const oneId = resolveUnit(first);
  if (oneId) return { unitId: oneId, rest: words.slice(1).join(" ") };
  const lower = first.toLowerCase().replace(/[^a-z-]/g, "");
  const nextWord = (words[1] || "").toLowerCase();
  const singularish = lower.replace(/s$/, "");
  const knownAdhoc = KNOWN_ADHOC.has(lower) || KNOWN_ADHOC.has(singularish);
  if (
    lower &&
    !NON_UNIT_WORDS.has(lower) &&
    /^[a-z-]+$/.test(lower) &&
    // Generic unknown words need confirming context ("N wedges lemon");
    // known countables are accepted outright. This keeps two-word
    // ingredient names like "bay leaves" intact.
    (knownAdhoc || words.length >= 3 || nextWord === "of")
  ) {
    const id = registerCountUnit(singularish);
    if (id) return { unitId: id, rest: words.slice(1).join(" ") };
  }
  // Trailing known count-unit fallback: "cinnamon stick", "bay leaves"
  // keep their descriptor words as the item and take only the final
  // count-dimension word as the unit.
  if (words.length >= 2 && !NON_UNIT_WORDS.has(lower)) {
    const lastRaw = words[words.length - 1];
    const lastLower = lastRaw.toLowerCase();
    const lastSingular = lastLower.replace(/es$|s$/, "");
    const lastId = resolveUnit(lastLower) || resolveUnit(lastSingular);
    if (lastId && getUnit(lastId).dim === DIMENSION.COUNT && lastId !== "each") {
      return {
        unitId: lastId,
        rest: words.slice(0, -1).join(" "),
      };
    }
  }
  return null;
}

function scanAmount(text) {
  const trimmed = text.trim();
  const re = new RegExp("^(" + QTY_TOKEN + ")\\s*", "i");
  const head = re.exec(trimmed);
  if (!head) {
    // vague quantifier detection
    const words0 = trimmed.split(/\s+/);
    const firstWord = (words0[0] || "").toLowerCase();
    if (VAGUE_QUANTIFIERS.has(firstWord)) {
      return {
        quantity: null,
        quantityMax: null,
        rest: words0.slice(1).join(" "),
        uncertain: true,
        uncertaintyReason: "no-quantity",
      };
    }
    return { quantity: null, quantityMax: null, rest: trimmed, uncertain: false, uncertaintyReason: null };
  }
  let quantity = numberTokenToFraction(head[1]);
  if (!quantity) {
    return {
      quantity: null,
      quantityMax: null,
      rest: text.trim(),
      uncertain: true,
      uncertaintyReason: "unparseable-amount",
    };
  }
  let rest = trimmed.slice(head[0].length);
  let quantityMax = null;
  const rangeSep = /^(\s*(?:[\u2013\u2014-]|to)\s*)/i.exec(rest);
  if (rangeSep) {
    const afterSep = rest.slice(rangeSep[0].length);
    const second = new RegExp("^(" + QTY_TOKEN + ")\\s*", "i").exec(afterSep);
    if (second) {
      const maxFrac = numberTokenToFraction(second[1]);
      if (maxFrac) {
        quantityMax = maxFrac;
        rest = afterSep.slice(second[0].length);
      }
    }
  }
  return { quantity, quantityMax, rest, uncertain: false, uncertaintyReason: null };
}

/**
 * Parse one ingredient line. Always returns a full structured object;
 * check `uncertain` before trusting quantity/unit/item blindly.
 */
export function parseIngredientLine(raw) {
  const original = String(raw == null ? "" : raw).trim();
  const out = {
    raw: original,
    quantity: null,
    quantityMax: null,
    unit: null,
    item: "",
    preparation: null,
    substitute: null,
    uncertain: false,
    uncertaintyReason: null,
  };
  if (!original) {
    out.uncertain = true;
    out.uncertaintyReason = "empty-line";
    return out;
  }

  // 1. substitution clause
  const sub = splitSubstitution(original);
  out.substitute = sub.substitute;

  // 2. preparation clauses vs core
  const split = splitPreparation(sub.main.replace(/^[-\u2022*]\s*/, ""));
  const core = split.core.replace(/[.;]+$/, "");
  if (split.preparation) out.preparation = split.preparation;

  // 3. multi-pack pattern
  const pack = matchMultiPack(core);
  if (pack) {
    out.quantity = pack.quantity;
    out.unit = pack.unit;
    out.item = pack.item;
    return out;
  }

  // 4. "juice/zest of N X" descriptor
  const desc = matchDescriptorOf(core);
  if (desc) {
    const scannedDesc = scanAmount(desc.rest);
    if (scannedDesc.quantity && scannedDesc.rest.trim()) {
      const baseItem = scannedDesc.rest.trim().split(/\s+/)[0];
      out.quantity = scannedDesc.quantity;
      out.quantityMax = scannedDesc.quantityMax;
      out.item = baseItem + " " + desc.descriptor;
      out.preparation = split.preparation
        ? split.preparation + ", " + desc.descriptor
        : desc.descriptor.charAt(0).toUpperCase() + desc.descriptor.slice(1);
      return out;
    }
  }

  // 5. standard amount scan
  const scanned = scanAmount(core);
  out.quantity = scanned.quantity;
  out.quantityMax = scanned.quantityMax;
  out.uncertain = scanned.uncertain;
  out.uncertaintyReason = scanned.uncertaintyReason;
  let remainder = scanned.rest;

  if (out.quantity) {
    const unitMatch = consumeUnit(remainder);
    if (unitMatch) {
      out.unit = unitMatch.unitId;
      remainder = unitMatch.rest;
    }
  }

  remainder = remainder.replace(/^of\s+/i, "").trim();
  out.item = remainder.replace(/\s{2,}/g, " ").trim();

  if (!out.item) {
    // amount with no item text at all
    out.uncertain = true;
    out.uncertaintyReason = "no-item";
  }
  return out;
}

/** Parse a pasted block: one ingredient per line, empties skipped. */
export function parseIngredientLines(textBlock) {
  return String(textBlock || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => parseIngredientLine(line));
}
