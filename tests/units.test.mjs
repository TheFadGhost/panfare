import { describe, it, expect } from "vitest";
import { makeFraction as F } from "../src/core/fraction.mjs";
import {
  resolveUnit, convert, tryConvert, convertWithDensity,
  lookupDensity, registerCountUnit, getUnit, dimensionOf,
  DIMENSION, UNITS,
} from "../src/core/units.mjs";

describe("unit alias resolution", () => {
  it("resolves common spellings and plurals", () => {
    expect(resolveUnit("cups")).toBe("cup");
    expect(resolveUnit("Cup")).toBe("cup");
    expect(resolveUnit("teaspoon")).toBe("tsp");
    expect(resolveUnit("fluid ounce")).toBe("floz");
    expect(resolveUnit("fl oz")).toBe("floz");
    expect(resolveUnit("grammes")).toBe("g");
    expect(resolveUnit("litre")).toBe("l");
    expect(resolveUnit("pounds")).toBe("lb");
    expect(resolveUnit("cloves")).toBe("clove");
  });
  it("returns null for unknown tokens instead of guessing", () => {
    expect(resolveUnit("handbasket")).toBe(null);
    expect(resolveUnit("")).toBe(null);
    expect(resolveUnit(null)).toBe(null);
  });
});

describe("exact conversion within a dimension", () => {
  it("3 tsp is exactly 1 tbsp", () => {
    expect(convert(F(3), "tsp", "tbsp")).toEqual({ n: 1, d: 1 });
  });
  it("16 tbsp is exactly 1 cup", () => {
    expect(convert(F(16), "tbsp", "cup")).toEqual({ n: 1, d: 1 });
  });
  it("240 ml is exactly 1 cup (documented kitchen convention)", () => {
    expect(convert(F(240), "ml", "cup")).toEqual({ n: 1, d: 1 });
  });
  it("converts back the other way exactly", () => {
    expect(convert(F(1), "cup", "ml")).toEqual({ n: 240, d: 1 });
    expect(convert(F(2), "lb", "oz")).toEqual({ n: 32, d: 1 });
    expect(convert(F(1), "kg", "g")).toEqual({ n: 1000, d: 1 });
  });
  it("keeps avoirdupois mass exact through rationals", () => {
    const oneOzInG = convert(F(1), "oz", "g");
    // 28.349523125 g exactly = 45359237/1600000
    expect(oneOzInG).toEqual({ n: 45359237, d: 1600000 });
  });
  it("round-trips volume conversions exactly", () => {
    for (const [a, b] of [["ml", "l"], ["tsp", "tbsp"], ["cup", "pint"], ["quart", "gallon"]]) {
      const v = F(37, 9);
      expect(convert(convert(v, a, b), b, a)).toEqual(v);
    }
  });
  it("refuses volume<->mass without density", () => {
    const r = tryConvert(F(2), "cup", "g");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("different-dimension");
  });
  it("throws on direct misuse across dimensions", () => {
    expect(() => convert(F(1), "g", "ml")).toThrow();
  });
});

describe("density-based volume<->mass conversion", () => {
  it("converts a cup of flour to grams using known density", () => {
    const flourDensity = lookupDensity("flour").density; // 55/100 g per ml
    const r = convertWithDensity(F(1), "cup", "g", flourDensity);
    expect(r.ok).toBe(true);
    // 240 ml x 0.55 = 132 g
    expect(r.value).toEqual({ n: 132, d: 1 });
  });
  it("converts grams back to millilitres with the same density", () => {
    const milkDensity = lookupDensity("milk").density; // 103/100
    const r = convertWithDensity(F(515), "g", "ml", milkDensity);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ n: 500, d: 1 });
  });
  it("refuses when no density is known — explicit, never guessed", () => {
    expect(lookupDensity("unicorn meat")).toBe(null);
    expect(lookupDensity("washing-up liquid")).toBe(null);
    const r = convertWithDensity(F(1), "cup", "g", null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-density-known");
  });
  it("finds densities behind qualified names via tail words", () => {
    expect(lookupDensity("plain flour")).not.toBe(null);
    expect(lookupDensity("granulated sugar")).not.toBe(null);
  });
});

describe("countable units", () => {
  it("registers ad-hoc countables once", () => {
    expect(registerCountUnit("wedge")).toBe("wedge");
    expect(registerCountUnit("wedge")).toBe("wedge");
    expect(getUnit("wedge").dim).toBe(DIMENSION.COUNT);
    expect(dimensionOf("wedge")).toBe("count");
  });
  it("never converts between distinct countables", () => {
    const r = tryConvert(F(3), "clove", "slice");
    expect(r.ok).toBe(false);
  });
});

describe("registry sanity", () => {
  it("every built-in unit has positive rational factor", () => {
    for (const u of Object.values(UNITS)) {
      expect(u.factor.n).toBeGreaterThan(0);
      expect(u.factor.d).toBeGreaterThan(0);
    }
  });
});
