// fraction.mjs — exact rational arithmetic for quantities.
//
// CONTRACT: every quantity in Panfare is one of these Fraction objects.
// Nothing anywhere converts a quantity to a float. All arithmetic uses
// integer operations on safe integers; overflow throws instead of drifting.

export class FractionOverflowError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "FractionOverflowError";
  }
}

export class DivisionByZeroError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "DivisionByZeroError";
  }
}

export class MalformedFractionError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "MalformedFractionError";
  }
}

function assertInt(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new MalformedFractionError(label + " must be an integer, got " + String(value));
  }
  if (!Number.isSafeInteger(value)) {
    throw new FractionOverflowError(label + " exceeds safe integer range");
  }
}

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

// A rational number n/d, always stored reduced with den > 0.
// Create with makeFraction(); never hand-roll {n, d} objects elsewhere.
export function makeFraction(n, d = 1) {
  assertInt(n, "numerator");
  assertInt(d, "denominator");
  if (d === 0) {
    throw new DivisionByZeroError("fraction denominator is zero");
  }
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  if (g > 1) {
    return { n: n / g, d: d / g };
  }
  return { n, d };
}

export const ZERO = makeFraction(0);
export const ONE = makeFraction(1);

// Exact rational from a finite decimal string, e.g. "0.75" -> 3/4.
export function fromDecimalString(str) {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(str).trim());
  if (!m) throw new MalformedFractionError("not a decimal number: " + str);
  const sign = m[1] === "-" ? -1 : 1;
  const digits = m[2] + (m[3] || "");
  if (digits.length > 15) {
    throw new FractionOverflowError("decimal too precise to represent exactly: " + str);
  }
  const n = Number(digits);
  const d = Number("1" + "0".repeat((m[3] || "").length));
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) {
    throw new FractionOverflowError("decimal too large to represent exactly: " + str);
  }
  return makeFraction(sign * n, d);
}

// Exact rational from textual forms: "3", "-2", "1/2", "0.75".
// Unicode vulgar fractions are handled by the parser layer, not here.
export function fromString(str) {
  const s = String(str).trim();
  const slashFrac = /^([+-]?)(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (slashFrac) {
    return makeFraction(Number(slashFrac[1] + slashFrac[2]), Number(slashFrac[3]));
  }
  return fromDecimalString(s);
}

function checked(op, n, d) {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) {
    throw new FractionOverflowError(op + " overflowed safe integers");
  }
  return makeFraction(n, d);
}

export function add(a, b) {
  // n1/d1 + n2/d2 = (n1*d2 + n2*d1) / (d1*d2)
  return checked("add", a.n * b.d + b.n * a.d, a.d * b.d);
}

export function sub(a, b) {
  return checked("sub", a.n * b.d - b.n * a.d, a.d * b.d);
}

export function mul(a, b) {
  // Cross-reduce before multiplying to keep intermediates small.
  const g1 = gcd(a.n, b.d);
  const g2 = gcd(b.n, a.d);
  return checked("mul", (a.n / g1) * (b.n / g2), (a.d / g2) * (b.d / g1));
}

export function div(a, b) {
  if (b.n === 0) throw new DivisionByZeroError("division by zero fraction");
  const g1 = gcd(a.n, b.n);
  const g2 = gcd(b.d, a.d);
  let n = (a.n / g1) * (b.d / g2);
  let d = (a.d / g2) * (b.n / g1);
  if (d < 0) {
    n = -n;
    d = -d;
  }
  return checked("div", n, d);
}

export function neg(a) {
  return { n: -a.n, d: a.d };
}

export function abs(a) {
  return { n: Math.abs(a.n), d: a.d };
}

// -1, 0 or 1. Never converts to float.
export function cmp(a, b) {
  const l = a.n * b.d;
  const r = b.n * a.d;
  if (!Number.isSafeInteger(l) || !Number.isSafeInteger(r)) {
    throw new FractionOverflowError("cmp overflowed safe integers");
  }
  if (l < r) return -1;
  if (l > r) return 1;
  return 0;
}

export const eq = (a, b) => cmp(a, b) === 0;
export const lt = (a, b) => cmp(a, b) < 0;
export const gt = (a, b) => cmp(a, b) > 0;
export const isZero = (a) => a.n === 0;
export const isNegative = (a) => a.n < 0;

// Whole part and proper remainder of a non-negative fraction.
// floorFrac({7,2}) -> {whole: 3, rest: {n:1, d:2}}
export function floorFrac(a) {
  if (isNegative(a)) throw new MalformedFractionError("floorFrac expects a non-negative fraction");
  const whole = Math.floor(a.n / a.d);
  return { whole, rest: makeFraction(a.n - whole * a.d, a.d) };
}

/**
 * Nearest fraction with denominator at most maxDen (display-side only).
 * Returns { value, approx } where approx is true when not exact.
 * Uses integer mediant-free search: best numerator per denominator via
 * cross-multiplication comparisons only.
 */
export function nearestWithDenominator(a, maxDen) {
  assertInt(maxDen, "maxDen");
  if (maxDen < 1) throw new MalformedFractionError("maxDen must be >= 1");
  if (a.d <= maxDen) return { value: { n: a.n, d: a.d }, approx: false };
  let bestN = 0;
  let bestD = 1;
  let bestDiffN = a.n; // |a - 0| compared as a.n*bestD - bestN*a.d
  let bestDiffD = a.d;
  for (let den = 1; den <= maxDen; den++) {
    // nearest numerator to a.n/den
    let num = Math.round((a.n * den) / a.d);
    if (num < 0) num = 0;
    // diff = |a.n/d.a - num/den| = |a.n*den - num*a.d| / (a.d*den)
    const diffN = Math.abs(a.n * den - num * a.d);
    const diffD = a.d * den;
    // compare diffN/diffD < bestDiffN/bestDiffD
    if (bestDiffN * diffD > diffN * bestDiffD) {
      bestDiffN = diffN;
      bestDiffD = diffD;
      bestN = num;
      bestD = den;
      if (diffN === 0) break;
    }
  }
  const value = makeFraction(bestN, bestD);
  return { value, approx: !eq(value, a) };
}

