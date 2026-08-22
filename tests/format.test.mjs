import { describe, it, expect } from "vitest";
import { makeFraction as F } from "../src/core/fraction.mjs";
import {
  formatFraction, formatQuantity, formatScalar, formatQuantityRange,
  spokenFraction, pickDisplayUnit, roundMetricBase,
} from "../src/core/format.mjs";

describe("fraction rendering", () => {
  it("renders every common denominator as a real glyph, never a decimal", () => {
    const cases = {
      "1/2": "\u00BD", "1/3": "\u2153", "2/3": "\u2154",
      "1/4": "\u00BC", "3/4": "\u00BE", "1/5": "\u2155",
      "2/5": "\u2156", "3/5": "\u2157", "4/5": "\u2158",
      "1/6": "\u2159", "5/6": "\u215A", "1/8": "\u215B",
      "3/8": "\u215C", "5/8": "\u215D", "7/8": "\u215E",
    };
    for (const [key, glyph] of Object.entries(cases)) {
      const [n, d] = key.split("/").map(Number);
      expect(formatFraction(F(n, d)).text).toBe(glyph);
      expect(formatFraction(F(n, d)).text).not.toMatch(/\d+\.\d+/);
    }
  });
  it("renders improper fractions as mixed numbers with glyphs", () => {
    expect(formatFraction(F(7, 4)).text).toBe("1\u00BE");
    expect(formatFraction(F(3, 2)).text).toBe("1\u00BD");
    expect(formatFraction(F(10, 3)).text).toBe("3\u2153");
  });
  it("falls back to a styled stacked fraction for odd denominators", () => {
    const r = formatFraction(F(13, 16));
    expect(r.text).toContain("\u2044");
    expect(r.text).toBe("13\u204416");
    expect(r.html).toContain("<sup>13</sup>");
    expect(r.html).toContain("<sub>16</sub>");
  });
  it("speaks quantities sensibly for screen readers", () => {
    expect(spokenFraction(F(3, 4))).toBe("three quarters");
    expect(spokenFraction(F(7, 4))).toBe("one and three quarters");
    expect(spokenFraction(F(1, 2))).toBe("one half");
  });
  it("whole numbers render plainly and are spoken as words", () => {
    const r = formatScalar(F(12));
    expect(r.text).toBe("12");
    expect(r.aria).toBe("twelve");
  });
});

describe("display unit selection", () => {
  it("promotes 3 tsp to exactly 1 tbsp", () => {
    const r = formatQuantity({ amount: F(3), unit: "tsp" });
    expect(r.text).toBe("1 tbsp");
  });
  it("keeps 2 tsp as 2 tsp — no premature promotion", () => {
    expect(formatQuantity({ amount: F(2), unit: "tsp" }).text).toBe("2 tsp");
  });
  it("240 ml stays 240 ml under metric preference", () => {
    expect(formatQuantity({ amount: F(240), unit: "ml" }, { system: "metric" }).text).toBe("240 ml");
  });
  it("240 ml becomes exactly 1 cup under imperial preference", () => {
    expect(formatQuantity({ amount: F(240), unit: "ml" }, { system: "imperial" }).text).toBe("1 cup");
  });
  it("16 tbsp collapses to 1 cup", () => {
    expect(formatQuantity({ amount: F(16), unit: "tbsp" }).text).toBe("1 cup");
  });
  it("1000 g becomes 1 kg; small gram amounts stay grams", () => {
    expect(formatQuantity({ amount: F(1000), unit: "g" }).text).toBe("1 kg");
    expect(formatQuantity({ amount: F(300), unit: "g" }).text).toBe("300 g");
  });
  it("metric base rounding is kitchen-precise and honest", () => {
    // 147.5735... ml -> nearest 5 -> 150 ml, error ~1.6% so unmarked
    const r = formatQuantity({ amount: F(14757353, 100000), unit: "ml" }, { system: "metric" });
    expect(r.text).toBe("150 ml");
    expect(r.approx).toBe(false);
  });
  it("marks larger metric rounding error with an explicit approx marker", () => {
    // 101 g scaled to 0.6 -> 60.6 g -> rounds to 61? (<100 -> whole) fine.
    // use a case where whole-gram rounding exceeds 2%: 40g x 1/30 = 4/3 g -> 1.5 g
    const r = roundMetricBase(F(4, 3));
    expect(r.approx).toBe(true);
  });
  it("454 g reads as 1 lb in imperial mode (0.09% off, within tolerance)", () => {
    const r = formatQuantity({ amount: F(454), unit: "g" }, { system: "imperial" });
    expect(r.text).toBe("1 lb");
    expect(r.approx).toBe(false);
  });
  it("pluralises only where convention wants it", () => {
    expect(formatQuantity({ amount: F(2), unit: "cup" }).text).toBe("2 cups");
    expect(formatQuantity({ amount: F(1), unit: "cup" }).text).toBe("1 cup");
    expect(formatQuantity({ amount: F(3), unit: "kg" }).text).toBe("3 kg");
    expect(formatQuantity({ amount: F(2), unit: "clove" }).text).toBe("2 cloves");
    expect(formatQuantity({ amount: F(1), unit: "each", labelless: true }).text).toBe("1");
  });
  it("count units are returned untouched regardless of system preference", () => {
    const r = pickDisplayUnit(F(3), "clove", { system: "imperial" });
    expect(r.unitId).toBe("clove");
    expect(r.amount).toEqual(F(3));
  });
});

describe("full quantity formatting", () => {
  it("formats quantity+unit+preparation-style output cleanly", () => {
    expect(formatQuantity({ amount: F(1, 2), unit: "cup" }).text).toBe("\u00BD cup");
    expect(formatQuantity({ amount: F(9, 4), unit: "cup" }).text).toBe("2\u00BC cups");
  });
  it("provides aria text that reads like speech", () => {
    const r = formatQuantity({ amount: F(3, 2), unit: "cup" });
    expect(r.aria).toBe("one and one half cups");
  });
  it("formats ranges with an en dash; unitless count labels stay quiet", () => {
    const r = formatQuantityRange(
      { amount: F(2), unit: "each" },
      { amount: F(3), unit: "each" }
    );
    expect(r.text).toBe("2\u20133");
    expect(r.aria).toContain("to");
    const cups = formatQuantityRange(
      { amount: F(1, 2), unit: "cup" },
      { amount: F(3, 4), unit: "cup" }
    );
    expect(cups.text).toBe("\u00BD cup\u2013\u00BE cup");
  });
  it("rejects malformed quantity objects loudly", () => {
    expect(() => formatQuantity(null)).toThrow();
    expect(() => formatQuantity({ amount: "two", unit: "cup" })).toThrow();
  });
});
