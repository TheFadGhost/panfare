import { describe, it, expect } from "vitest";
import { makeFraction as F } from "../src/core/fraction.mjs";
import {
  SECTIONS_ORDER,
  DEFAULT_STAPLES,
  classifySection,
  buildShoppingList,
  mergeQuantities,
} from "../src/core/shoppingList.mjs";

let lineCounter = 0;
function line(item, amount, unit, preparation = null) {
  lineCounter += 1;
  return {
    id: "i_" + String(lineCounter).padStart(3, "0"),
    raw: item,
    quantity: amount == null ? null : amount,
    quantityMax: null,
    unit,
    item,
    preparation,
    substitute: null,
    sectionOverride: null,
    staple: false,
  };
}

function recipe(id, serves, lines) {
  return {
    id,
    title: id,
    yield: serves == null ? null : { serves, text: "serves " + serves },
    ingredients: lines,
    steps: [],
  };
}

const KEPT_SEPARATE = "kept separate: different units with no reliable conversion";

function findItem(list, key, section = null) {
  for (const group of list.groups) {
    if (section && group.section !== section) continue;
    const found = group.items.find((i) => i.key === key);
    if (found) return found;
  }
  return null;
}

describe("exports", () => {
  it("exposes the contract section order", () => {
    expect([...SECTIONS_ORDER]).toEqual([
      "Produce",
      "Bakery",
      "Dairy & chilled",
      "Meat & fish",
      "Frozen",
      "Pantry",
      "Spices & baking",
      "Other",
    ]);
  });
  it("exposes the default staples list", () => {
    expect([...DEFAULT_STAPLES]).toEqual([
      "salt",
      "black pepper",
      "olive oil",
      "vegetable oil",
      "butter",
      "flour",
      "granulated sugar",
      "water",
    ]);
  });
});

describe("classifySection", () => {
  it("assigns produce", () => {
    expect(classifySection("carrots")).toBe("Produce");
    expect(classifySection("garlic")).toBe("Produce");
    expect(classifySection("bell peppers")).toBe("Produce");
    expect(classifySection("green beans")).toBe("Produce");
    expect(classifySection("baby spinach")).toBe("Produce");
  });
  it("assigns dairy & chilled including eggs", () => {
    expect(classifySection("cheddar")).toBe("Dairy & chilled");
    expect(classifySection("free-range eggs")).toBe("Dairy & chilled");
    expect(classifySection("double cream")).toBe("Dairy & chilled");
    expect(classifySection("unsalted butter")).toBe("Dairy & chilled");
  });
  it("assigns meat & fish", () => {
    expect(classifySection("chicken thigh")).toBe("Meat & fish");
    expect(classifySection("smoked bacon")).toBe("Meat & fish");
    expect(classifySection("prawns")).toBe("Meat & fish");
  });
  it("assigns spices & baking", () => {
    expect(classifySection("paprika")).toBe("Spices & baking");
    expect(classifySection("black pepper")).toBe("Spices & baking");
    expect(classifySection("caster sugar")).toBe("Spices & baking");
    expect(classifySection("baking powder")).toBe("Spices & baking");
  });
  it("assigns pantry including tinned goods", () => {
    expect(classifySection("tinned tomatoes")).toBe("Pantry");
    expect(classifySection("canned chickpeas")).toBe("Pantry");
    expect(classifySection("olive oil")).toBe("Pantry");
    expect(classifySection("plain flour")).toBe("Pantry");
    expect(classifySection("chicken stock")).toBe("Pantry");
    expect(classifySection("red lentils")).toBe("Pantry");
  });
  it("assigns bakery and frozen before other maps", () => {
    expect(classifySection("sourdough")).toBe("Bakery");
    expect(classifySection("pitta bread")).toBe("Bakery");
    expect(classifySection("frozen peas")).toBe("Frozen");
    expect(classifySection("ice cream")).toBe("Frozen");
  });
  it("falls back to Other without guessing", () => {
    expect(classifySection("unknown gadget")).toBe("Other");
    expect(classifySection("water")).toBe("Other");
    expect(classifySection("")).toBe("Other");
    expect(classifySection(null)).toBe("Other");
  });
});

describe("mergeQuantities", () => {
  it("sums identical countable units exactly", () => {
    const r = mergeQuantities([
      { amount: F(2), unit: "clove" },
      { amount: F(3), unit: "clove" },
    ]);
    expect(r.quantities).toEqual([{ amount: F(5), unit: "clove", approx: false }]);
    expect(r.notes).toEqual([]);
  });

  it("keeps different countable units separate with a reason", () => {
    const r = mergeQuantities([
      { amount: F(1), unit: "clove" },
      { amount: F(2), unit: "slice" },
    ]);
    expect(r.quantities).toEqual([
      { amount: F(1), unit: "clove", approx: false },
      { amount: F(2), unit: "slice", approx: false },
    ]);
    expect(r.notes).toEqual([KEPT_SEPARATE]);
  });

  it("sums mixed volume units into ml under the kitchen convention", () => {
    const r = mergeQuantities([
      { amount: F(500), unit: "ml" },
      { amount: F(2), unit: "cup" },
    ]);
    expect(r.quantities).toEqual([{ amount: F(980), unit: "ml", approx: false }]);
  });

  it("sums mass across metric and imperial exactly as a rational", () => {
    const r = mergeQuantities([
      { amount: F(400), unit: "g" },
      { amount: F(8), unit: "oz" },
    ]);
    expect(r.quantities).toEqual([
      { amount: F(125359237, 200000), unit: "g", approx: false },
    ]);
  });

  it("merges volume+mass through known density and marks approx", () => {
    const r = mergeQuantities(
      [
        { amount: F(1), unit: "cup" },
        { amount: F(300), unit: "g" },
      ],
      { density: F(55, 100) }
    );
    expect(r.quantities).toEqual([{ amount: F(432), unit: "g", approx: true }]);
    expect(r.approx).toBe(true);
  });

  it("refuses volume+mass merging when density is unknown", () => {
    const r = mergeQuantities([
      { amount: F(1), unit: "cup" },
      { amount: F(50), unit: "g" },
    ]);
    expect(r.quantities.length).toBe(2);
    expect(r.quantities[0]).toEqual({ amount: F(240), unit: "ml", approx: false });
    expect(r.quantities[1]).toEqual({ amount: F(50), unit: "g", approx: false });
    expect(r.notes).toEqual([KEPT_SEPARATE]);
  });

  it("bridges to metric only when explicitly asked", () => {
    const r = mergeQuantities([{ amount: F(2), unit: "cup" }], { system: "metric" });
    expect(r.quantities).toEqual([{ amount: F(480), unit: "ml", approx: false }]);
  });
});

describe("buildShoppingList: cross-recipe unit merges", () => {
  const r1 = recipe("r_water_soup", 4, [line("water", F(500), "ml")]);
  const r2 = recipe("r_water_rice", 2, [line("water", F(2), "cup")]);

  it("merges 500 ml + 2 cups into one exact 980 ml entry", () => {
    const list = buildShoppingList([
      { recipe: r1, servings: null },
      { recipe: r2, servings: null },
    ]);
    const water = findItem(list, "water");
    expect(water).not.toBeNull();
    expect(water.key).toBe("water");
    expect(water.displayName).toBe("water");
    expect(water.recipeIds).toEqual(["r_water_soup", "r_water_rice"]);
    expect(water.quantities).toEqual([
      { amount: F(980), unit: "ml", approx: false },
    ]);
    expect(water.notes).toEqual([]);
  });

  it("merges grams + ounces within one dimension exactly", () => {
    const list = buildShoppingList([
      { recipe: recipe("r_a", 4, [line("chickpeas", F(400), "g")]), servings: null },
      { recipe: recipe("r_b", 4, [line("chickpeas", F(8), "oz")]), servings: null },
    ]);
    const item = findItem(list, "chickpea");
    expect(item.quantities).toEqual([
      { amount: F(125359237, 200000), unit: "g", approx: false },
    ]);
  });

  it("uses known flour density: 1 cup + 300 g becomes exact 432 g marked approx", () => {
    const list = buildShoppingList([
      { recipe: recipe("r_f1", 4, [line("flour", F(1), "cup")]), servings: null },
      { recipe: recipe("r_f2", 4, [line("flour", F(300), "g")]), servings: null },
    ]);
    const flour = findItem(list, "flour");
    expect(flour.quantities).toEqual([{ amount: F(432), unit: "g", approx: true }]);
  });

  it("merges two volume lines of olive oil exactly (no density involved)", () => {
    const list = buildShoppingList([
      {
        recipe: recipe("r_o1", 4, [line("olive oil", F(1), "cup")]),
        servings: null,
      },
      {
        recipe: recipe("r_o2", 4, [line("olive oil", F(50), "ml")]),
        servings: null,
      },
    ]);
    const oil = findItem(list, "olive oil");
    expect(oil.quantities).toEqual([
      { amount: F(290), unit: "ml", approx: false },
    ]);
    expect(oil.notes).toEqual([]);
  });

  it("resolves olive oil volume+mass via the oil family density: 1342/5 g approx", () => {
    const list = buildShoppingList([
      {
        recipe: recipe("r_o1", 4, [line("olive oil", F(1), "cup")]),
        servings: null,
      },
      {
        recipe: recipe("r_o2", 4, [line("olive oil", F(50), "g")]),
        servings: null,
      },
    ]);
    const oil = findItem(list, "olive oil");
    expect(oil.quantities).toEqual([
      { amount: F(1342, 5), unit: "g", approx: true },
    ]);
  });

  it("merges cream volume+mass via density: 199 g approx", () => {
    const list = buildShoppingList([
      { recipe: recipe("r_c1", 2, [line("cream", F(100), "ml")]), servings: null },
      { recipe: recipe("r_c2", 2, [line("cream", F(100), "g")]), servings: null },
    ]);
    const cream = findItem(list, "cream");
    expect(cream.quantities).toEqual([{ amount: F(199), unit: "g", approx: true }]);
  });
});

describe("buildShoppingList: countables and refusals", () => {
  it("sums cloves across recipes to exactly 5", () => {
    const list = buildShoppingList([
      {
        recipe: recipe("r_g1", 2, [line("garlic", F(2), "clove")]),
        servings: null,
      },
      {
        recipe: recipe("r_g2", 2, [line("garlic", F(3), "clove")]),
        servings: null,
      },
    ]);
    const garlic = findItem(list, "garlic");
    expect(garlic.quantities).toEqual([
      { amount: F(5), unit: "clove", approx: false },
    ]);
    expect(garlic.notes).toEqual([]);
  });

  it("keeps count vs mass separate inside one item with the reason", () => {
    const list = buildShoppingList([
      {
        recipe: recipe("r_b1", 2, [line("bacon", F(4), "rasher")]),
        servings: null,
      },
      {
        recipe: recipe("r_b2", 2, [line("bacon", F(100), "g")]),
        servings: null,
      },
    ]);
    const bacon = findItem(list, "bacon");
    expect(bacon.quantities).toEqual([
      { amount: F(4), unit: "rasher", approx: false },
      { amount: F(100), unit: "g", approx: false },
    ]);
    expect(bacon.notes).toEqual([KEPT_SEPARATE]);
  });

  it("never cross-merges different names even in the same section", () => {
    const list = buildShoppingList([
      {
        recipe: recipe("r_p", 4, [
          line("rice", F(1), "cup"),
          line("chickpeas", F(200), "g"),
        ]),
        servings: null,
      },
    ]);
    const rice = findItem(list, "rice");
    const chickpeas = findItem(list, "chickpea");
    expect(rice.key).toBe("rice");
    expect(chickpeas.key).toBe("chickpea");
    expect(rice.quantities).toEqual([
      { amount: F(240), unit: "ml", approx: false },
    ]);
    expect(chickpeas.quantities).toEqual([
      { amount: F(200), unit: "g", approx: false },
    ]);
    expect(rice.notes).toEqual([]);
    expect(chickpeas.notes).toEqual([]);
  });
});

describe("buildShoppingList: preparations", () => {
  it("merges none+sifted into preparations ['sifted'] with no note", () => {
    const list = buildShoppingList([
      {
        recipe: recipe("r_pr1", 4, [line("flour", F(100), "g", null)]),
        servings: null,
      },
      {
        recipe: recipe("r_pr2", 4, [line("flour", F(50), "g", "sifted")]),
        servings: null,
      },
    ]);
    const flour = findItem(list, "flour");
    expect(flour.preparations).toEqual(["sifted"]);
    expect(flour.notes).toEqual([]);
  });

  it("merges chopped+melted butter but records the preparation clash note", () => {
    const list = buildShoppingList([
      {
        recipe: recipe("r_pm1", 4, [line("butter", F(50), "g", "chopped")]),
        servings: null,
      },
      {
        recipe: recipe("r_pm2", 4, [line("butter", F(50), "g", "melted")]),
        servings: null,
      },
    ]);
    const butter = findItem(list, "butter");
    expect(butter.quantities).toEqual([{ amount: F(100), unit: "g", approx: false }]);
    expect(butter.preparations).toEqual(["chopped", "melted"]);
    expect(butter.notes).toEqual(["different preparations: chopped / melted"]);
  });
});

describe("buildShoppingList: scaling", () => {
  it("triples amounts exactly when serves 2 is planned at 6", () => {
    const list = buildShoppingList([
      {
        recipe: recipe("r_s", 2, [line("rice", F(150), "g")]),
        servings: 6,
      },
    ]);
    const rice = findItem(list, "rice");
    expect(rice.quantities).toEqual([{ amount: F(450), unit: "g", approx: false }]);
  });

  it("applies exact fractional factors (6 from serves 4 = x3/2)", () => {
    const list = buildShoppingList([
      {
        recipe: recipe("r_t", 4, [
          line("flour", F(200), "g"),
          line("milk", F(1), "cup"),
        ]),
        servings: 6,
      },
    ]);
    expect(findItem(list, "flour").quantities).toEqual([
      { amount: F(300), unit: "g", approx: false },
    ]);
    expect(findItem(list, "milk").quantities).toEqual([
      { amount: F(360), unit: "ml", approx: false },
    ]);
  });

  it("never scales when servings are omitted or yield.serves is unknown", () => {
    const list = buildShoppingList([
      {
        recipe: recipe("r_n1", 4, [line("cocoa", F(120), "g")]),
        servings: null,
      },
      {
        recipe: recipe("r_n2", null, [line("oats", F(100), "g")]),
        servings: 4,
      },
    ]);
    expect(findItem(list, "cocoa").quantities).toEqual([
      { amount: F(120), unit: "g", approx: false },
    ]);
    expect(findItem(list, "oat").quantities).toEqual([
      { amount: F(100), unit: "g", approx: false },
    ]);
  });

  it("accepts Fraction servings", () => {
    const list = buildShoppingList([
      {
        recipe: recipe("r_fr", 4, [line("honey", F(2), "tbsp")]),
        servings: F(5),
      },
    ]);
    expect(findItem(list, "honey").quantities).toEqual([
      { amount: F(75, 2), unit: "ml", approx: false },
    ]);
  });
});

describe("buildShoppingList: staples", () => {
  const stapleRecipes = [
    {
      recipe: recipe("r_st", 4, [
        line("salt", F(500), "g"),
        line("plain flour", F(300), "g"),
        line("unsalted butter", F(50), "g"),
        line("granulated sugar", F(100), "g"),
        line("water", F(250), "ml"),
        line("carrots", F(2), "each"),
      ]),
      servings: null,
    },
  ];

  it("hides staples by normalized name and counts distinct hidden items", () => {
    const list = buildShoppingList(stapleRecipes, { excludeStaples: true });
    expect(list.hiddenStaples).toBe(5);
    const keys = list.groups.flatMap((g) => g.items.map((i) => i.key));
    expect(keys).toEqual(["carrot"]);
  });

  it("keeps everything when exclusion is off", () => {
    const list = buildShoppingList(stapleRecipes, { excludeStaples: false });
    expect(list.hiddenStaples).toBe(0);
    expect(list.groups.flatMap((g) => g.items).length).toBe(6);
  });

  it("honours a custom staples list", () => {
    const list = buildShoppingList(stapleRecipes, {
      excludeStaples: true,
      staples: ["salt"],
    });
    expect(list.hiddenStaples).toBe(1);
    expect(findItem(list, "flour")).not.toBeNull();
    expect(findItem(list, "butter")).not.toBeNull();
    expect(findItem(list, "carrot")).not.toBeNull();
  });
});

describe("buildShoppingList: ordering determinism", () => {
  const mixed = [
    {
      recipe: recipe("r_m1", 4, [
        line("rice", F(200), "g"),
        line("carrots", F(2), "each"),
        line("apples", F(3), "each"),
        line("water", F(100), "ml"),
      ]),
      servings: null,
    },
    {
      recipe: recipe("r_m2", 4, [
        line("olive oil", F(2), "tbsp"),
        line("butter", F(30), "g"),
      ]),
      servings: null,
    },
  ];

  it("orders groups per SECTIONS_ORDER and items alphabetically", () => {
    const list = buildShoppingList(mixed, {});
    const sections = list.groups.map((g) => g.section);
    expect(sections).toEqual(["Produce", "Dairy & chilled", "Pantry", "Other"]);
    const orderOf = (s) => SECTIONS_ORDER.indexOf(s);
    for (let i = 1; i < sections.length; i++) {
      expect(orderOf(sections[i - 1])).toBeLessThan(orderOf(sections[i]));
    }
    const names = list.groups.map((g) => g.items.map((i) => i.displayName));
    expect(names).toEqual([
      ["apples", "carrots"],
      ["butter"],
      ["olive oil", "rice"],
      ["water"],
    ]);
    expect(list.sectionsOrder).toEqual(SECTIONS_ORDER);
  });
});

describe("buildShoppingList: three-recipe regression with exact rationals", () => {
  const inputs = [
    {
      recipe: recipe("r_a", 4, [
        line("butter", F(250), "g"),
        line("garlic", F(2), "clove"),
        line("carrots", F(2), "each"),
      ]),
      servings: 4,
    },
    {
      recipe: recipe("r_b", 2, [
        line("butter", F(125), "g"),
        line("water", F(1), "cup"),
        line("carrots", F(1), "each"),
      ]),
      servings: 6,
    },
    {
      recipe: recipe("r_c", 3, [
        line("water", F(750), "ml"),
        line("garlic", F(3), "clove"),
        line("plain flour", F(300), "g"),
      ]),
      servings: 1,
    },
  ];

  const list = buildShoppingList(inputs, {});

  it("produces exact merged totals as reduced rationals", () => {
    const butter = findItem(list, "butter");
    expect(butter.quantities).toEqual([{ amount: F(625), unit: "g", approx: false }]);
    expect(butter.recipeIds).toEqual(["r_a", "r_b"]);

    const garlic = findItem(list, "garlic");
    expect(garlic.quantities).toEqual([
      { amount: F(3), unit: "clove", approx: false },
    ]);
    expect(garlic.recipeIds).toEqual(["r_a", "r_c"]);

    const carrots = findItem(list, "carrot");
    expect(carrots.quantities).toEqual([
      { amount: F(5), unit: "each", approx: false },
    ]);
    expect(carrots.displayName).toBe("carrots");

    const water = findItem(list, "water");
    expect(water.quantities).toEqual([
      { amount: F(970), unit: "ml", approx: false },
    ]);
    expect(water.recipeIds).toEqual(["r_b", "r_c"]);

    const flour = findItem(list, "flour");
    expect(flour.quantities).toEqual([{ amount: F(100), unit: "g", approx: false }]);
    expect(flour.displayName).toBe("plain flour");
  });

  it("emits sections in walking order with alphabetical items", () => {
    expect(list.groups.map((g) => g.section)).toEqual([
      "Produce",
      "Dairy & chilled",
      "Pantry",
      "Other",
    ]);
    const produce = list.groups.find((g) => g.section === "Produce");
    expect(produce.items.map((i) => i.displayName)).toEqual(["carrots", "garlic"]);
    expect(list.hiddenStaples).toBe(0);
  });

  it("picks the most frequent wording as displayName", () => {
    const inputsTie = [
      {
        recipe: recipe("r_d1", 4, [line("carrots", F(1), "each")]),
        servings: null,
      },
      {
        recipe: recipe("r_d2", 4, [line("carrot", F(1), "each")]),
        servings: null,
      },
      {
        recipe: recipe("r_d3", 4, [line("carrots", F(1), "each")]),
        servings: null,
      },
    ];
    const tieList = buildShoppingList(inputsTie, {});
    expect(findItem(tieList, "carrot").displayName).toBe("carrots");
  });
});
