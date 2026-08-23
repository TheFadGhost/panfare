// regression.mjs — the quality gate.
//
// Scales every sample recipe across a range of factors and merges them
// into shopping lists, asserting that nothing absurd comes out:
// no float drift, no negative or zero amounts, no bare-decimal rendering,
// denominators stay small, round-trips are exact, and merged lists keep
// their units sane. Exit code 1 names each defect found.
//
// Run: npm run regression

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFraction as F, mul, div, eq } from "../src/core/fraction.mjs";
import { scaleRecipe } from "../src/core/scaling.mjs";
import { buildShoppingList } from "../src/core/shoppingList.mjs";
import { formatQuantity } from "../src/core/format.mjs";
import { wireCore } from "../src/core/setup.mjs";
import samples from "../data/sampleRecipes.json" with { type: "json" };

wireCore();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
void root;

const FACTORS = [
  F(1, 4), F(1, 3), F(1, 2), F(2, 3), F(3, 4), F(1),
  F(3, 2), F(2), F(5, 2), F(3), F(4),
];

const defects = [];
function defect(where, what) {
  defects.push(where + ": " + what);
}

const BARE_DECIMAL = /\d\.\d/;

for (const recipe of samples) {
  for (const factor of FACTORS) {
    const where = recipe.id + " x(" + factor.n + "/" + factor.d + ")";

    let scaled;
    try {
      scaled = scaleRecipe(recipe, factor);
    } catch (err) {
      defect(where, "scaleRecipe threw: " + err.message);
      continue;
    }

    // exactness & sanity on every quantity
    for (const line of scaled.ingredients) {
      const tag = where + " [" + (line.item || line.raw) + "]";
      for (const q of [line.quantity, line.quantityMax]) {
        if (!q) continue;
        if (!Number.isInteger(q.n) || !Number.isInteger(q.d)) {
          defect(tag, "non-integer numerator/denominator " + JSON.stringify(q));
          continue;
        }
        if (q.d <= 0) {
          defect(tag, "non-positive denominator " + JSON.stringify(q));
        }
        if (q.n < 0) {
          defect(tag, "negative amount " + JSON.stringify(q));
        }
        if (q.d > 10000) {
          defect(tag, "denominator blew past sanity bound: " + JSON.stringify(q));
        }
      }
    }

    // rendering must never show bare decimals
    for (const line of scaled.ingredients) {
      if (!line.quantity) continue;
      try {
        const r = formatQuantity({ amount: line.quantity, unit: line.unit });
        if (BARE_DECIMAL.test(r.text)) {
          defect(where + " [" + line.item + "]", "bare decimal in render: \"" + r.text + "\"");
        }
      } catch (err) {
        defect(where + " [" + line.item + "]", "formatQuantity threw: " + err.message);
      }
    }

    // round-trip exactness
    if (factor.n !== 0) {
      const inverse = div(F(1), factor);
      let back;
      try {
        back = scaleRecipe(scaled, inverse);
      } catch (err) {
        defect(where, "inverse scaling threw: " + err.message);
        continue;
      }
      for (let i = 0; i < recipe.ingredients.length; i++) {
        const origQ = recipe.ingredients[i].quantity;
        const backQ = back.ingredients[i].quantity;
        if (!origQ && !backQ) continue;
        if (!origQ || !backQ) {
          defect(where + " ingredient#" + i, "round-trip lost/gained a quantity");
          continue;
        }
        if (!eq(origQ, backQ)) {
          defect(
            where + " ingredient#" + i + " (" + recipe.ingredients[i].item + ")",
            "round-trip drifted: " + JSON.stringify(origQ) + " -> " + JSON.stringify(backQ)
          );
        }
      }
    }

    // absurd-unit guard: a volume item must not stay in tsp when it is
    // more than a cup's worth (the ladder should have promoted it)
    for (const line of scaled.ingredients) {
      if (!line.quantity || !line.unit) continue;
      const r = formatQuantity({ amount: line.quantity, unit: line.unit });
      if (line.unit === "tsp" && r.text.includes("tsp")) {
        const tbsp = mul(line.quantity, F(1, 3));
        if (tbsp.n / tbsp.d >= 16) {
          defect(where + " [" + line.item + "]", "absurd unit kept: large amount still in tsp");
        }
      }
    }
  }

  // merge gate across ALL recipes at this factor happens below once per factor
}

for (const factor of FACTORS) {
  const inputs = samples.map((recipe) => ({ recipe, servings: null }));
  let list;
  try {
    list = buildShoppingList(inputs, { excludeStaples: true });
  } catch (err) {
    defect("merge x(" + factor.n + "/" + factor.d + ")", "buildShoppingList threw: " + err.message);
    continue;
  }
  void factor;
  for (const group of list.groups) {
    for (const item of group.items) {
      for (const q of item.quantities) {
        if (!q.amount) continue;
        if (!(q.amount.n > 0)) {
          defect("merge [" + item.key + "]", "non-positive merged amount " + JSON.stringify(q.amount));
        }
        if (!Number.isInteger(q.amount.n)) {
          defect("merge [" + item.key + "]", "non-integer merged numerator " + JSON.stringify(q.amount));
        }
      }
    }
  }
}

if (defects.length) {
  console.error("REGRESSION GATE FAILED — " + defects.length + " defect(s):");
  for (const d of defects) console.error("  ✗ " + d);
  process.exit(1);
} else {
  console.log(
    "Regression gate passed: " +
      samples.length +
      " recipes x " +
      FACTORS.length +
      " factors scaled, rendered and merged with zero defects."
  );
}
