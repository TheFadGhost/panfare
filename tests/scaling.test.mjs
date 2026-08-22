import { describe, it, expect } from "vitest";
import { makeFraction as F, eq } from "../src/core/fraction.mjs";
import {
  scaleFraction,
  scaleIngredientLine,
  classifyNonLinear,
  scaleRecipe,
  scaleStepText,
  parseStepTimers,
  numberTokenToFraction,
} from "../src/core/scaling.mjs";

const line = (overrides = {}) => ({
  id: "i_001",
  raw: "100 g flour",
  quantity: F(1),
  quantityMax: null,
  unit: "g",
  item: "flour",
  preparation: null,
  substitute: null,
  sectionOverride: null,
  staple: false,
  ...overrides,
});

describe("scaleFraction", () => {
  it("makes 1/3 cup x3 exactly 1 cup (fraction comparison, not strings)", () => {
    const result = scaleFraction(F(1, 3), F(3));
    expect(eq(result, F(1))).toBe(true);
    expect(result).toEqual({ n: 1, d: 1 });
  });
  it("makes eighths exact", () => {
    expect(scaleFraction(F(1, 8), F(3))).toEqual({ n: 3, d: 8 });
    expect(eq(scaleFraction(F(7, 8), F(8)), F(7))).toBe(true);
  });
  it("keeps halves x two-thirds exact", () => {
    expect(scaleFraction(F(1, 2), F(2, 3))).toEqual({ n: 1, d: 3 });
  });
  it("never produces float drift through long chains", () => {
    let q = F(1, 3);
    let maxDen = 1;
    for (const k of [F(5, 3), F(7, 5), F(3, 2), F(2, 3), F(9, 7)]) {
      q = scaleFraction(q, k);
      maxDen = Math.max(maxDen, q.d);
    }
    expect(maxDen).toBeLessThanOrEqual(64);
    for (const k of [F(3, 5), F(5, 7), F(2, 3), F(3, 2), F(7, 9)]) {
      q = scaleFraction(q, k);
    }
    expect(q).toEqual({ n: 1, d: 3 });
  });
});

describe("scaleIngredientLine", () => {
  it("scales quantity and quantityMax exactly", () => {
    const l = line({
      quantity: F(2),
      quantityMax: F(3),
      item: "carrot",
      raw: "2\u20133 carrots",
    });
    const out = scaleIngredientLine(l, F(2, 3));
    expect(out.quantity).toEqual({ n: 4, d: 3 });
    expect(out.quantityMax).toEqual({ n: 2, d: 1 });
  });
  it("leaves null quantities null and never mutates the input", () => {
    const l = line({ quantity: null, quantityMax: null });
    const snapshot = JSON.stringify(l);
    const out = scaleIngredientLine(l, F(3));
    expect(out.quantity).toBeNull();
    expect(out.quantityMax).toBeNull();
    expect(JSON.stringify(l)).toBe(snapshot);
  });
  it("keeps id/raw/item/unit and adds no private fields", () => {
    const out = scaleIngredientLine(line(), F(2));
    expect(out.id).toBe("i_001");
    expect(out.raw).toBe("100 g flour");
    expect(out.item).toBe("flour");
    expect(out.unit).toBe("g");
    expect("_scaled" in out).toBe(false);
    expect(Object.keys(out).sort()).toEqual([
      "id", "item", "preparation", "quantity", "quantityMax", "raw",
      "sectionOverride", "staple", "substitute", "unit",
    ]);
  });
  it("round-trips x5/3 then x3/5 to identical fractions", () => {
    const l = line({ quantity: F(2, 3), quantityMax: F(3, 4) });
    const once = scaleIngredientLine(l, F(5, 3));
    const back = scaleIngredientLine(once, F(3, 5));
    expect(back.quantity).toEqual({ n: 2, d: 3 });
    expect(back.quantityMax).toEqual({ n: 3, d: 4 });
  });
});

describe("classifyNonLinear", () => {
  const cat = (item) =>
    classifyNonLinear(line({ item, raw: `some ${item}` }))?.category;

  it("flags leavening agents", () => {
    for (const item of [
      "baking powder",
      "baking soda",
      "bicarbonate of soda",
      "dried yeast",
      "instant yeast",
      "sourdough starter",
    ]) {
      expect(cat(item)).toBe("leavening");
    }
  });
  it("flags salt including qualified forms but not salted butter", () => {
    for (const item of ["salt", "fine salt", "sea salt", "kosher salt"]) {
      expect(cat(item)).toBe("salt");
    }
    expect(cat("salted butter")).toBeUndefined();
    expect(cat("unsalted butter")).toBeUndefined();
    expect(cat("butter")).toBeUndefined();
  });
  it("raw fallback catches matches when normalised name misses", () => {
    expect(
      classifyNonLinear(line({ item: "mystery mix", raw: "pinch of salt" }))
        ?.category,
    ).toBe("salt");
    expect(
      classifyNonLinear(line({ item: "", raw: "1 tbsp baking powder" }))
        ?.category,
    ).toBe("leavening");
  });
  it("flags heat and spice, excluding bell peppers", () => {
    for (const item of [
      "black pepper",
      "cayenne pepper",
      "chilli flakes",
      "chili powder",
      "smoked paprika",
      "ground cumin",
      "ground cinnamon",
      "curry powder",
      "mixed spice",
    ]) {
      expect(cat(item)).toBe("spice");
    }
    expect(cat("bell pepper")).toBeUndefined();
    expect(cat("capsicum")).toBeUndefined();
  });
  it("flags cooking alcohol and vinegar reductions", () => {
    for (const item of [
      "red wine",
      "white wine",
      "beer",
      "dark rum",
      "brandy",
      "whiskey",
      "white wine vinegar",
    ]) {
      expect(cat(item)).toBe("alcohol");
    }
  });
  it("does not flag ordinary linear ingredients", () => {
    for (const item of [
      "plain flour", "eggs", "butter", "whole milk", "red lentils", "olive oil",
    ]) {
      expect(cat(item)).toBeUndefined();
    }
  });
  it("returns exact guidance strings per category", () => {
    expect(classifyNonLinear(line({ item: "baking powder" }))).toEqual({
      category: "leavening",
      guidance:
        "leavening does not scale linearly \u2014 adjust and watch the rise",
    });
    expect(classifyNonLinear(line({ item: "sea salt" })).guidance).toBe(
      "season to taste after scaling",
    );
    expect(classifyNonLinear(line({ item: "paprika" })).guidance).toBe(
      "heat and spice do not scale linearly",
    );
    expect(classifyNonLinear(line({ item: "red wine" })).guidance).toBe(
      "reduction strength changes with volume",
    );
  });
  it("is safe on junk input", () => {
    expect(classifyNonLinear(null)).toBeNull();
    expect(classifyNonLinear(line({ item: "", raw: "" }))).toBeNull();
  });
});

const baseRecipe = () => ({
  id: "r_test",
  title: "Test Bake",
  yield: { serves: 4, text: "serves 4" },
  times: { prep: 10, cook: 30, extra: [] },
  ingredients: [
    line({
      id: "i_001", item: "plain flour", raw: "300 g plain flour",
      quantity: F(300), unit: "g",
    }),
    line({
      id: "i_002", item: "baking powder", raw: "2 tsp baking powder",
      quantity: F(2), unit: "tsp",
    }),
    line({
      id: "i_003", item: "carrot", raw: "2\u20133 carrots",
      quantity: F(2), quantityMax: F(3), unit: "each",
    }),
    line({
      id: "i_004", item: "salt", raw: "salt to taste",
      quantity: null, unit: null,
    }),
  ],
  steps: [
    { text: "Whisk in 1\u00BD cups flour." },
    { text: "Bake for 35 minutes." },
    { text: "Preheat oven to 200\u00B0C." },
  ],
  notes: null,
  tags: [],
  source: { url: null, title: null, author: null },
  rating: null,
  history: [],
  photo: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("scaleRecipe", () => {
  it("scales every line exactly and warns only for non-linear ones at factor != 1", () => {
    const recipe = baseRecipe();
    const snapshot = JSON.stringify(recipe);
    const out = scaleRecipe(recipe, F(2, 3));

    expect(out.ingredients[0].quantity).toEqual(F(200));
    expect(out.ingredients[2].quantity).toEqual({ n: 4, d: 3 });
    expect(out.ingredients[2].quantityMax).toEqual({ n: 2, d: 1 });

    expect(out.warnings).toHaveLength(2);
    expect(out.warnings[0]).toEqual({
      lineId: "i_002",
      item: "baking powder",
      category: "leavening",
      guidance:
        "leavening does not scale linearly \u2014 adjust and watch the rise",
    });
    expect(out.warnings[1]).toEqual({
      lineId: "i_004",
      item: "salt",
      category: "salt",
      guidance: "season to taste after scaling",
    });
    expect(JSON.stringify(recipe)).toBe(snapshot);
    expect(out).not.toBe(recipe);
  });

  it("scales yield.serves with exact nearest-whole integer math", () => {
    expect(scaleRecipe(baseRecipe(), F(2, 3)).yield.serves).toBe(3); // 8/3 -> 3
    const five = { ...baseRecipe(), yield: { serves: 5, text: "serves 5" } };
    expect(scaleRecipe(five, F(3, 2)).yield.serves).toBe(8); // 7.5 -> 8
    expect(scaleRecipe(five, F(1, 3)).yield.serves).toBe(2); // 5/3 -> 2
    expect(scaleRecipe(five, F(2)).yield.serves).toBe(10);
  });

  it("leaves times untouched and scales steps via scaleStepText", () => {
    const out = scaleRecipe(baseRecipe(), F(3));
    expect(out.times).toEqual({ prep: 10, cook: 30, extra: [] });
    expect(out.steps[0].text).toBe("Whisk in 4\u00BD cups flour.");
    expect(out.steps[1].text).toBe("Bake for 35 minutes.");
    expect(out.steps[1].flags).toHaveLength(1);
    expect(out.steps[1].flags[0].type).toBe("time");
    expect(out.steps[2].text).toBe("Preheat oven to 200\u00B0C.");
    expect(out.steps[2].flags).toEqual([]);
  });

  it("at factor 1 emits no warnings property and changes nothing", () => {
    const out = scaleRecipe(baseRecipe(), F(1));
    expect("warnings" in out).toBe(false);
    expect(out.yield.serves).toBe(4);
    expect(out.ingredients[0].quantity).toEqual(F(300));
    expect(out.steps.map((s) => s.text)).toEqual([
      "Whisk in 1\u00BD cups flour.",
      "Bake for 35 minutes.",
      "Preheat oven to 200\u00B0C.",
    ]);
  });

  it("round-trips a whole recipe x5/3 then x3/5 identically", () => {
    const up = scaleRecipe(baseRecipe(), F(5, 3));
    const down = scaleRecipe(up, F(3, 5));
    expect(down.ingredients[0].quantity).toEqual(F(300));
    expect(down.ingredients[2].quantity).toEqual(F(2));
    expect(down.ingredients[2].quantityMax).toEqual(F(3));
  });
});

describe("scaleStepText", () => {
  it("rewrites mixed unicode quantities exactly (1\u00BD cups x 2/3 -> 1 cup)", () => {
    const r = scaleStepText("Whisk in 1\u00BD cups flour.", F(2, 3));
    expect(r.text).toBe("Whisk in 1 cups flour.");
    expect(r.flags).toEqual([]);
  });

  it("leaves durations untouched but flags them", () => {
    const r = scaleStepText("Bake for 35 minutes.", F(3));
    expect(r.text).toBe("Bake for 35 minutes.");
    expect(r.flags).toEqual([
      { type: "time", snippet: "Bake for 35 minutes." },
    ]);
  });

  it("never scales temperatures, any factor, no flags", () => {
    for (const factor of [F(2), F(3), F(2, 3)]) {
      expect(scaleStepText("Preheat oven to 200\u00B0C.", factor).text).toBe(
        "Preheat oven to 200\u00B0C.",
      );
      expect(scaleStepText("Preheat oven to 200\u00B0C.", factor).flags).toEqual(
        [],
      );
    }
    expect(scaleStepText("Preheat to 425\u00B0F then bake.", F(2)).text).toBe(
      "Preheat to 425\u00B0F then bake.",
    );
    expect(scaleStepText("Heat to 350 degrees Fahrenheit.", F(2)).text).toBe(
      "Heat to 350 degrees Fahrenheit.",
    );
    expect(scaleStepText("Heat to 180 degrees C.", F(2)).text).toBe(
      "Heat to 180 degrees C.",
    );
    expect(scaleStepText("Cook at gas mark 6.", F(3)).text).toBe(
      "Cook at gas mark 6.",
    );
  });

  it("scales both ends of dash ranges joined by en dash", () => {
    expect(scaleStepText("Add 2\u20133 tbsp oil", F(2)).text).toBe(
      "Add 4\u20136 tbsp oil",
    );
    expect(scaleStepText("Add 2-3 tbsp oil", F(2)).text).toBe(
      "Add 4\u20136 tbsp oil",
    );
  });

  it("scales 'to' ranges preserving the connector word", () => {
    expect(scaleStepText("Add 2 to 3 tbsp oil", F(2)).text).toBe(
      "Add 4 to 6 tbsp oil",
    );
  });

  it("leaves serving words untouched", () => {
    expect(scaleStepText("Serves 4.", F(3)).text).toBe("Serves 4.");
    expect(scaleStepText("This batter makes 12 cupcakes.", F(2)).text).toBe(
      "This batter makes 12 cupcakes.",
    );
  });

  it("leaves list markers and ordinals untouched", () => {
    expect(scaleStepText("1. Preheat the oven.", F(2)).text).toBe(
      "1. Preheat the oven.",
    );
    expect(scaleStepText("Fold in the 3rd egg.", F(2)).text).toBe(
      "Fold in the 3rd egg.",
    );
  });

  it("scales ascii mixed numbers, decimals and stacked fractions exactly", () => {
    expect(scaleStepText("Stir in 1 1/2 cups oats.", F(2)).text).toBe(
      "Stir in 3 cups oats.",
    );
    expect(scaleStepText("Pour in 0.5 litres of stock.", F(2)).text).toBe(
      "Pour in 1 litres of stock.",
    );
    expect(scaleStepText("Grate 13\u204416 lb cheese.", F(16)).text).toBe(
      "Grate 13 lb cheese.",
    );
  });

  it("scales vulgar glyphs and glyph-mixed forms exactly", () => {
    expect(scaleStepText("Add \u00BD tsp vanilla", F(4)).text).toBe(
      "Add 2 tsp vanilla",
    );
    expect(scaleStepText("Use 2\u00BC cups flour.", F(2)).text).toBe(
      "Use 4\u00BD cups flour.",
    );
  });

  it("flags compound and word durations without multiplying them", () => {
    const compound = scaleStepText("Prove for 1 hour 15 minutes.", F(5));
    expect(compound.text).toBe("Prove for 1 hour 15 minutes.");
    expect(compound.flags).toHaveLength(1);

    const word = scaleStepText("Let sit for an hour.", F(2));
    expect(word.text).toBe("Let sit for an hour.");
    expect(word.flags).toHaveLength(1);
    expect(word.flags[0].type).toBe("time");

    const multi = scaleStepText("Chill 20 minutes, then bake 35 minutes.", F(2));
    expect(multi.text).toBe("Chill 20 minutes, then bake 35 minutes.");
    expect(multi.flags).toHaveLength(2);
  });

  it("skips years but keeps whitelisted unit quantities", () => {
    expect(scaleStepText("A family recipe since 1965.", F(2)).text).toBe(
      "A family recipe since 1965.",
    );
    expect(scaleStepText("Simmer 1800 ml stock.", F(2)).text).toBe(
      "Simmer 3600 ml stock.",
    );
  });

  it("renders awkward exact results as stacked fractions, never floats", () => {
    const r = scaleStepText("Add 1/3 cup sugar", F(1, 3));
    expect(r.text).toContain("1\u20449");
    expect(r.text).not.toContain("0.11");
  });
});

describe("parseStepTimers", () => {
  it("extracts simple minute timers", () => {
    expect(parseStepTimers("Bake for 35 minutes.")).toEqual([
      { label: "35 minutes", seconds: 2100 },
    ]);
  });

  it("sums compound durations into one timer", () => {
    expect(parseStepTimers("Prove for 1 hour 15 minutes, then shape.")).toEqual([
      { label: "1 hour 15 minutes", seconds: 4500 },
    ]);
  });

  it("uses range lower bounds and notes the range in the label", () => {
    expect(parseStepTimers("Bake for 25\u201330 minutes.")).toEqual([
      { label: "25\u201330 minutes", seconds: 1500 },
    ]);
    expect(parseStepTimers("Roast 15 to 20 mins")).toEqual([
      { label: "15 to 20 mins", seconds: 900 },
    ]);
  });

  it("returns multiple timers in order", () => {
    expect(parseStepTimers("Rest 20 minutes, then bake for 40 minutes.")).toEqual([
      { label: "20 minutes", seconds: 1200 },
      { label: "40 minutes", seconds: 2400 },
    ]);
  });

  it("handles hours, vulgar glyphs and word durations", () => {
    expect(parseStepTimers("Chill for 2 hours.")[0].seconds).toBe(7200);
    expect(parseStepTimers("Simmer 1\u00BD hours")[0].seconds).toBe(5400);
    expect(parseStepTimers("Rest an hour.")).toEqual([
      { label: "an hour", seconds: 3600 },
    ]);
    expect(parseStepTimers("Marinate half an hour.")).toEqual([
      { label: "half an hour", seconds: 1800 },
    ]);
  });

  it("finds nothing where there is nothing", () => {
    expect(parseStepTimers("Preheat oven to 200\u00B0C.")).toEqual([]);
    expect(parseStepTimers("Serves 4 immediately.")).toEqual([]);
    expect(parseStepTimers("")).toEqual([]);
  });
});

describe("numberTokenToFraction", () => {
  it("parses every supported numeric form", () => {
    expect(numberTokenToFraction("1 1/2")).toEqual({ n: 3, d: 2 });
    expect(numberTokenToFraction("3/4")).toEqual({ n: 3, d: 4 });
    expect(numberTokenToFraction("\u00BE")).toEqual({ n: 3, d: 4 });
    expect(numberTokenToFraction("1\u00BD")).toEqual({ n: 3, d: 2 });
    expect(numberTokenToFraction("13\u204416")).toEqual({ n: 13, d: 16 });
    expect(numberTokenToFraction("0.75")).toEqual({ n: 3, d: 4 });
    expect(numberTokenToFraction("2")).toEqual({ n: 2, d: 1 });
  });
});

