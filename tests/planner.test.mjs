import { describe, it, expect } from "vitest";
import {
  createPlan,
  assignSlot,
  removeSlot,
  moveSlot,
  planToShoppingInputs,
  planToJson,
  planFromJson,
  DAY_LABELS,
} from "../src/core/planner.mjs";

const LABELS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("createPlan", () => {
  it("creates seven empty days Monday..Sunday", () => {
    const plan = createPlan();
    expect(plan.days).toHaveLength(7);
    expect(plan.days.map((d) => d.label)).toEqual(LABELS);
    for (const day of plan.days) expect(day.slots).toEqual([]);
  });

  it("exposes an always-empty top-level slots mirror and never reuses label objects", () => {
    const plan = createPlan();
    expect(plan.slots).toEqual([]);
    const other = createPlan();
    expect(plan.days[0]).not.toBe(other.days[0]);
    expect(DAY_LABELS).toEqual(LABELS);
  });
});

describe("assignSlot", () => {
  it("appends when slotIndex is null and returns a NEW plan", () => {
    const plan = createPlan();
    const before = snapshot(plan);
    const next = assignSlot(plan, 0, null, { recipeId: "r_a", servings: 2 });
    expect(next).not.toBe(plan);
    expect(next.days[0].slots).toEqual([{ recipeId: "r_a", servings: 2 }]);
    expect(plan).toEqual(before);
  });

  it("replaces at an existing index without touching neighbours", () => {
    let plan = createPlan();
    plan = assignSlot(plan, 2, null, { recipeId: "r_a", servings: 1 });
    plan = assignSlot(plan, 2, null, { recipeId: "r_b", servings: 3 });
    plan = assignSlot(plan, 2, 0, { recipeId: "r_c", servings: 4 });
    expect(plan.days[2].slots).toEqual([
      { recipeId: "r_c", servings: 4 },
      { recipeId: "r_b", servings: 3 },
    ]);
  });

  it("accepts index === length as append position", () => {
    let plan = createPlan();
    plan = assignSlot(plan, 6, null, { recipeId: "r_a", servings: 2 });
    const next = assignSlot(plan, 6, 1, { recipeId: "r_b", servings: 2 });
    expect(next.days[6].slots).toEqual([
      { recipeId: "r_a", servings: 2 },
      { recipeId: "r_b", servings: 2 },
    ]);
  });

  it("does not share slot objects with the input plan", () => {
    const plan = createPlan();
    const next = assignSlot(plan, 0, null, { recipeId: "r_a", servings: 2 });
    expect(next.days[0].slots[0]).not.toBe(plan.days[0].slots[0]);
  });

  it("throws RangeError on out-of-range dayIndex (including non-integers)", () => {
    const plan = createPlan();
    expect(() => assignSlot(plan, -1, null, { recipeId: "r_a", servings: 1 })).toThrow(RangeError);
    expect(() => assignSlot(plan, 7, null, { recipeId: "r_a", servings: 1 })).toThrow(RangeError);
    expect(() => assignSlot(plan, 1.5, null, { recipeId: "r_a", servings: 1 })).toThrow(RangeError);
    expect(() => assignSlot(plan, NaN, null, { recipeId: "r_a", servings: 1 })).toThrow(RangeError);
  });

  it("throws RangeError on bad slotIndex", () => {
    const plan = assignSlot(createPlan(), 0, null, { recipeId: "r_a", servings: 1 });
    expect(() => assignSlot(plan, 0, -1, { recipeId: "r_b", servings: 1 })).toThrow(RangeError);
    expect(() => assignSlot(plan, 0, 5, { recipeId: "r_b", servings: 1 })).toThrow(RangeError);
    expect(() => assignSlot(plan, 0, 0.5, { recipeId: "r_b", servings: 1 })).toThrow(RangeError);
  });

  it("throws RangeError unless servings is an integer > 0", () => {
    const plan = createPlan();
    for (const bad of [0, -2, 1.5, NaN, Infinity, null]) {
      expect(() => assignSlot(plan, 0, null, { recipeId: "r_a", servings: bad })).toThrow(
        RangeError
      );
    }
  });

  it("throws TypeError without a usable recipeId", () => {
    const plan = createPlan();
    expect(() => assignSlot(plan, 0, null, { servings: 2 })).toThrow(TypeError);
    expect(() => assignSlot(plan, 0, null, { recipeId: "", servings: 2 })).toThrow(TypeError);
  });
});

describe("removeSlot", () => {
  function seeded() {
    let plan = createPlan();
    plan = assignSlot(plan, 0, null, { recipeId: "r_a", servings: 2 });
    plan = assignSlot(plan, 0, null, { recipeId: "r_b", servings: 2 });
    plan = assignSlot(plan, 0, null, { recipeId: "r_c", servings: 2 });
    return plan;
  }

  it("removes exactly the targeted slot and closes the gap", () => {
    const plan = seeded();
    const before = snapshot(plan);
    const next = removeSlot(plan, 0, 1);
    expect(next.days[0].slots.map((s) => s.recipeId)).toEqual(["r_a", "r_c"]);
    expect(plan).toEqual(before);
  });

  it("rejects invalid indices with RangeError", () => {
    const plan = seeded();
    expect(() => removeSlot(plan, 0, 3)).toThrow(RangeError);
    expect(() => removeSlot(plan, 0, -1)).toThrow(RangeError);
    expect(() => removeSlot(plan, 7, 0)).toThrow(RangeError);
  });
});

describe("moveSlot", () => {
  function twoDays() {
    let plan = createPlan();
    plan = assignSlot(plan, 0, null, { recipeId: "r_a", servings: 1 });
    plan = assignSlot(plan, 0, null, { recipeId: "r_b", servings: 1 });
    plan = assignSlot(plan, 0, null, { recipeId: "r_c", servings: 1 });
    plan = assignSlot(plan, 4, null, { recipeId: "r_d", servings: 1 });
    return plan;
  }

  it("moves a slot between days to the given insertion index", () => {
    const plan = twoDays();
    const before = snapshot(plan);
    const next = moveSlot(plan, 0, 1, 4, 0);
    expect(next.days[0].slots.map((s) => s.recipeId)).toEqual(["r_a", "r_c"]);
    expect(next.days[4].slots.map((s) => s.recipeId)).toEqual(["r_b", "r_d"]);
    expect(plan).toEqual(before);
  });

  it("reorders within one day using post-removal destination indexing", () => {
    const plan = twoDays();
    const next = moveSlot(plan, 0, 0, 0, 2);
    expect(next.days[0].slots.map((s) => s.recipeId)).toEqual(["r_b", "r_c", "r_a"]);
  });

  it("allows appending at the end via toIdx === target length", () => {
    const plan = twoDays();
    const next = moveSlot(plan, 0, 2, 4, 1);
    expect(next.days[4].slots.map((s) => s.recipeId)).toEqual(["r_d", "r_c"]);
    expect(() => moveSlot(plan, 0, 2, 4, 2)).toThrow(RangeError); // past-the-end is invalid here
  });

  it("validates every index", () => {
    const plan = twoDays();
    expect(() => moveSlot(plan, 0, 3, 1, 0)).toThrow(RangeError);
    expect(() => moveSlot(plan, 0, 0, 7, 0)).toThrow(RangeError);
    expect(() => moveSlot(plan, 0, 0, 0, 9)).toThrow(RangeError);
  });
});

describe("planToShoppingInputs", () => {
  const soup = { id: "r_soup", title: "Soup", yield: { serves: 4 } };
  const cake = { id: "r_cake", title: "Cake", yield: {} };
  const byMap = new Map([
    ["r_soup", soup],
    ["r_cake", cake],
  ]);

  function planWith(entries) {
    return {
      days: entries.map((label, i) => ({ label, slots: [] })),
      slots: [],
    };
  }

  it("flattens in day-then-slot order and skips unknown recipeIds", () => {
    const plan = planWith(LABELS);
    plan.days[0].slots.push({ recipeId: "r_soup", servings: 2 });
    plan.days[0].slots.push({ recipeId: "r_ghost", servings: 3 });
    plan.days[5].slots.push({ recipeId: "r_cake", servings: 8 });
    const inputs = planToShoppingInputs(plan, byMap);
    expect(inputs.map((i) => i.recipe.id)).toEqual(["r_soup", "r_cake"]);
    expect(inputs[0].servings).toBe(2);
    expect(inputs[1].servings).toBe(8);
  });

  it("defaults servings to recipe.yield.serves, else null, when slot omits them", () => {
    const plan = planWith(LABELS);
    plan.days[1].slots.push({ recipeId: "r_soup" });
    plan.days[2].slots.push({ recipeId: "r_cake", servings: null });
    const inputs = planToShoppingInputs(plan, byMap);
    expect(inputs[0]).toEqual({ recipe: soup, servings: 4 });
    expect(inputs[1]).toEqual({ recipe: cake, servings: null });
  });

  it("accepts a plain object as the recipe lookup", () => {
    const plan = planWith(LABELS);
    plan.days[3].slots.push({ recipeId: "r_soup", servings: 6 });
    const inputs = planToShoppingInputs(plan, { r_soup: soup });
    expect(inputs).toHaveLength(1);
    expect(inputs[0].servings).toBe(6);
  });
});

describe("serialization round-trip", () => {
  it("planFromJson(planToJson(p)) deep-equals p", () => {
    let plan = createPlan();
    plan = assignSlot(plan, 0, null, { recipeId: "r_a", servings: 2 });
    plan = assignSlot(plan, 6, null, { recipeId: "r_b", servings: 5 });
    const json = planToJson(plan);
    expect(json).not.toHaveProperty("slots");
    expect(planFromJson(JSON.parse(JSON.stringify(json)))).toEqual(plan);
  });

  it("planToJson output survives JSON.stringify/parse unchanged", () => {
    const plan = assignSlot(createPlan(), 3, null, { recipeId: "r_x", servings: 1 });
    expect(JSON.parse(JSON.stringify(planToJson(plan)))).toEqual(planToJson(plan));
  });

  it("planFromJson throws TypeError on malformed shapes", () => {
    expect(() => planFromJson(null)).toThrow(TypeError);
    expect(() => planFromJson(42)).toThrow(TypeError);
    expect(() => planFromJson([])).toThrow(TypeError);
    expect(() => planFromJson({})).toThrow(TypeError);
    expect(() => planFromJson({ days: [] })).toThrow(TypeError);
    expect(() => planFromJson({ days: LABELS.map((l) => ({ label: l, slots: {} })) })).toThrow(
      TypeError
    );
    expect(() =>
      planFromJson({
        days: LABELS.map((l) => ({ label: l, slots: [{ recipeId: "r_a", servings: 0 }] })),
      })
    ).toThrow(RangeError);
    expect(() =>
      planFromJson({
        days: LABELS.map((l) => ({ label: l, slots: [{ recipeId: "r_a", servings: 1.5 }] })),
      })
    ).toThrow(RangeError);
    expect(() =>
      planFromJson({ days: LABELS.map((l) => ({ label: l, slots: [{ servings: 2 }] })) })
    ).toThrow(TypeError);
  });

  it("planFromJson falls back to canonical labels and normalises missing servings to null", () => {
    const parsed = planFromJson({
      days: LABELS.map((_, i) => ({
        label: i === 1 ? "" : LABELS[i],
        slots: i === 0 ? [{ recipeId: "r_a" }] : [],
      })),
    });
    expect(parsed.days[0]).toEqual({ label: "Monday", slots: [{ recipeId: "r_a", servings: null }] });
    expect(parsed.days[1].label).toBe("Tuesday");
  });
});
