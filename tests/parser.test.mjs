import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFraction as F } from "../src/core/fraction.mjs";
import {
  parseIngredientLine,
  parseIngredientLines,
  numberTokenToFraction,
} from "../src/core/parser.mjs";

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/ingredient-lines.json"), "utf8")
);

const arr = (pair) => (pair ? F(pair[0], pair[1]) : null);

describe("number token parsing", () => {
  it("parses every textual amount form exactly", () => {
    expect(numberTokenToFraction("2")).toEqual(F(2));
    expect(numberTokenToFraction("0.75")).toEqual(F(3, 4));
    expect(numberTokenToFraction("1/2")).toEqual(F(1, 2));
    expect(numberTokenToFraction("1 1/2")).toEqual(F(3, 2));
    expect(numberTokenToFraction("\u00BD")).toEqual(F(1, 2));
    expect(numberTokenToFraction("1\u00BD")).toEqual(F(3, 2));
    expect(numberTokenToFraction("3\u20444")).toEqual(F(3, 4)); // U+2044 form
    expect(numberTokenToFraction("a")).toEqual(F(1));
    expect(numberTokenToFraction("an")).toEqual(F(1));
  });
});

describe("fixture set (" + fixtures.length + " original lines)", () => {
  it("has at least forty lines", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(40);
  });

  for (const fx of fixtures) {
    it("parses: " + fx.raw, () => {
      const line = parseIngredientLine(fx.raw);
      const e = fx.expect;
      if (e.quantity === null) {
        expect(line.quantity).toBeNull();
      } else {
        expect(line.quantity).toEqual(arr(e.quantity));
      }
      expect(line.quantityMax && e.quantityMax ? line.quantityMax : line.quantityMax)
        .toEqual(arr(e.quantityMax));
      expect(line.unit).toBe(e.unit);
      expect(line.item).toBe(e.item);
      expect(line.preparation).toBe(e.preparation);
      expect(line.substitute).toBe(e.substitute);
      expect(line.uncertain).toBe(e.uncertain);
    });
  }

  it("never produces a non-positive denominator", () => {
    for (const fx of fixtures) {
      const line = parseIngredientLine(fx.raw);
      if (line.quantity) expect(line.quantity.d).toBeGreaterThan(0);
      if (line.quantityMax) expect(line.quantityMax.d).toBeGreaterThan(0);
    }
  });
});

describe("equivalence and safety", () => {
  it("\u00BD cup equals 0.5 cup equals 1/2 cup", () => {
    const a = parseIngredientLine("\u00BD cup rice");
    const b = parseIngredientLine("0.5 cup rice");
    const c = parseIngredientLine("1/2 cup rice");
    expect(a.quantity).toEqual(b.quantity);
    expect(b.quantity).toEqual(c.quantity);
    expect(a.unit).toBe(b.unit);
  });
  it("keeps the raw text verbatim", () => {
    const line = parseIngredientLine("2 tbsp soy sauce");
    expect(line.raw).toBe("2 tbsp soy sauce");
  });
  it("empty input is flagged, never dropped", () => {
    const line = parseIngredientLine("");
    expect(line.uncertain).toBe(true);
    expect(line.uncertaintyReason).toBe("empty-line");
  });
  it("uncertain lines still carry their item text", () => {
    const line = parseIngredientLine("several potatoes");
    expect(line.uncertain).toBe(true);
    expect(line.item.toLowerCase()).toContain("potato");
  });
  it("bullet markers are stripped", () => {
    const line = parseIngredientLine("- 2 carrots, grated");
    expect(line.quantity).toEqual(F(2));
    expect(line.item).toBe("carrots");
    expect(line.preparation).toBe("grated");
  });
});

describe("block parsing", () => {
  it("splits a pasted block skipping empty lines", () => {
    const block = "\n2 cups oats\n\n1 tsp cinnamon\n\n";
    const lines = parseIngredientLines(block);
    expect(lines.length).toBe(2);
    expect(lines[0].item).toBe("oats");
    expect(lines[1].unit).toBe("tsp");
  });
});
