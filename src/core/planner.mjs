// planner.mjs — 7-day meal planner over the CONTRACT plan shape.
//
// Plans are plain serialisable data:
//   { days: [{ label: "Monday", slots: [{ recipeId, servings }] } x7], slots: [] }
// The top-level `slots` array is an always-empty compatibility mirror kept so
// callers can treat a plan as "{ days, slots }"; the canonical stored shape
// (planToJson) carries only `days`, exactly as CONTRACT.md specifies.
//
// Every function is pure: inputs are never mutated, new plan objects are
// returned. Servings are integers — no floats anywhere near quantities.

export const DAY_LABELS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

const DAYS_COUNT = 7;

function assertInt(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RangeError(label + " must be an integer, got " + String(value));
  }
}

function assertDayIndex(dayIndex, label = "dayIndex") {
  assertInt(dayIndex, label);
  if (dayIndex < 0 || dayIndex > DAYS_COUNT - 1) {
    throw new RangeError(
      label + " must be between 0 and " + (DAYS_COUNT - 1) + ", got " + String(dayIndex)
    );
  }
}

function assertServings(servings) {
  if (typeof servings !== "number" || !Number.isInteger(servings) || servings <= 0) {
    throw new RangeError("servings must be an integer > 0, got " + String(servings));
  }
}

function assertRecipeId(recipeId) {
  if (typeof recipeId !== "string" || recipeId.length === 0) {
    throw new TypeError("recipeId must be a non-empty string");
  }
}

/** Structural validation shared by every transform and by planFromJson. */
export function validatePlanShape(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new TypeError("plan must be an object");
  }
  if (!Array.isArray(plan.days) || plan.days.length !== DAYS_COUNT) {
    throw new TypeError("plan.days must be an array of " + DAYS_COUNT + " entries");
  }
  for (let d = 0; d < DAYS_COUNT; d++) {
    const day = plan.days[d];
    if (!day || typeof day !== "object" || Array.isArray(day)) {
      throw new TypeError("plan.days[" + d + "] must be an object");
    }
    if (typeof day.label !== "string") {
      throw new TypeError('plan.days[' + d + '].label must be a string');
    }
    if (!Array.isArray(day.slots)) {
      throw new TypeError("plan.days[" + d + "].slots must be an array");
    }
    for (let s = 0; s < day.slots.length; s++) {
      const slot = day.slots[s];
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
        throw new TypeError("plan.days[" + d + "].slots[" + s + "] must be an object");
      }
      assertRecipeId(slot.recipeId);
      if (slot.servings != null) {
        assertServings(slot.servings);
      }
    }
  }
  return true;
}

export function createPlan() {
  return {
    days: DAY_LABELS.map((label) => ({ label, slots: [] })),
    slots: [],
  };
}

/**
 * Fresh deep copy of { days, slots: [] } from any validated plan-like input.
 * Slots are copied field-by-field so caller-owned slot objects are never
 * shared with the result.
 */
function clonePlan(plan) {
  validatePlanShape(plan);
  return {
    days: plan.days.map((day) => ({
      label: day.label,
      slots: day.slots.map((slot) => ({
        recipeId: slot.recipeId,
        servings: slot.servings == null ? null : slot.servings,
      })),
    })),
    slots: [],
  };
}

/**
 * Add or replace a slot on one day. slotIndex === null appends to the end of
 * that day's slots; a number targets an existing index (or the position just
 * past the end, i.e. an append). Returns a NEW plan.
 */
export function assignSlot(plan, dayIndex, slotIndex, entry) {
  assertDayIndex(dayIndex);
  const next = clonePlan(plan);
  const slots = next.days[dayIndex].slots;
  if (entry == null || typeof entry !== "object") {
    throw new TypeError("entry must be an object {recipeId, servings}");
  }
  assertRecipeId(entry.recipeId);
  assertServings(entry.servings);
  const slot = { recipeId: entry.recipeId, servings: entry.servings };
  if (slotIndex === null || slotIndex === undefined) {
    slots.push(slot);
    return next;
  }
  assertInt(slotIndex, "slotIndex");
  if (slotIndex < 0 || slotIndex > slots.length) {
    throw new RangeError(
      "slotIndex must be between 0 and " + slots.length + " for this day, got " + String(slotIndex)
    );
  }
  slots[slotIndex] = slot;
  return next;
}

/** Remove one slot. Returns a NEW plan. */
export function removeSlot(plan, dayIndex, slotIndex) {
  assertDayIndex(dayIndex);
  const next = clonePlan(plan);
  const slots = next.days[dayIndex].slots;
  assertInt(slotIndex, "slotIndex");
  if (slotIndex < 0 || slotIndex >= slots.length) {
    throw new RangeError(
      "slotIndex must be between 0 and " + (slots.length - 1) + " for this day, got " + String(slotIndex)
    );
  }
  slots.splice(slotIndex, 1);
  return next;
}

/**
 * Move a slot from (fromDay, fromIdx) to (toDay, toIdx). The destination
 * index counts positions in the target day AFTER removal of the source slot
 * (standard splice semantics), so moving within a day is predictable.
 * Returns a NEW plan.
 */
export function moveSlot(plan, fromDay, fromIdx, toDay, toIdx) {
  assertDayIndex(fromDay, "fromDay");
  assertDayIndex(toDay, "toDay");
  assertInt(toIdx, "toIdx");
  const next = clonePlan(plan);
  const fromSlots = next.days[fromDay].slots;
  assertInt(fromIdx, "fromIdx");
  if (fromIdx < 0 || fromIdx >= fromSlots.length) {
    throw new RangeError(
      "fromIdx must be between 0 and " + (fromSlots.length - 1) + ", got " + String(fromIdx)
    );
  }
  const [slot] = fromSlots.splice(fromIdx, 1);
  const toSlots = next.days[toDay].slots;
  if (toIdx < 0 || toIdx > toSlots.length) {
    // `next` is discarded when this throws — the caller's plan was never touched.
    throw new RangeError(
      "toIdx must be between 0 and " + toSlots.length + ", got " + String(toIdx)
    );
  }
  toSlots.splice(toIdx, 0, slot);
  return next;
}

/**
 * Flatten a plan into shopping-list inputs: [{ recipe, servings }] in day
 * then slot order. Unknown recipeIds are skipped silently. A slot without a
 * usable servings count defaults to recipe.yield.serves when present,
 * otherwise null (the list builder decides how to render unscaled lines).
 * recipesById may be a Map or a plain object keyed by id.
 */
export function planToShoppingInputs(plan, recipesById) {
  validatePlanShape(plan);
  const lookup = (id) =>
    recipesById instanceof Map ? recipesById.get(id) : recipesById ? recipesById[id] : undefined;

  const inputs = [];
  for (const day of plan.days) {
    for (const slot of day.slots) {
      const recipe = lookup(slot.recipeId);
      if (!recipe || typeof recipe !== "object") continue;
      const serves =
        recipe.yield && typeof recipe.yield === "object" ? recipe.yield.serves : undefined;
      const defaultServings =
        typeof serves === "number" && Number.isInteger(serves) && serves > 0 ? serves : null;
      const servings =
        typeof slot.servings === "number" &&
        Number.isInteger(slot.servings) &&
        slot.servings > 0
          ? slot.servings
          : defaultServings;
      inputs.push({ recipe, servings });
    }
  }
  return inputs;
}

/** Canonical serialisable shape per CONTRACT: { days: [...] }. */
export function planToJson(plan) {
  validatePlanShape(plan);
  return {
    days: plan.days.map((day) => ({
      label: day.label,
      slots: day.slots.map((slot) => ({
        recipeId: slot.recipeId,
        servings: slot.servings == null ? null : slot.servings,
      })),
    })),
  };
}

/**
 * Rebuild a plan from parsed JSON. Defensive: throws TypeError with a clear
 * message on malformed input rather than returning a half-formed plan.
 */
export function planFromJson(json) {
  if (json == null || typeof json !== "object" || Array.isArray(json)) {
    throw new TypeError("plan JSON must be an object with a days array");
  }
  if (!Array.isArray(json.days) || json.days.length !== DAYS_COUNT) {
    throw new TypeError("plan JSON .days must be an array of " + DAYS_COUNT + " entries");
  }
  const days = json.days.map((day, d) => {
    if (!day || typeof day !== "object" || Array.isArray(day)) {
      throw new TypeError("plan JSON .days[" + d + "] must be an object");
    }
    const label =
      typeof day.label === "string" && day.label.trim().length > 0 ? day.label : DAY_LABELS[d];
    if (!Array.isArray(day.slots)) {
      throw new TypeError("plan JSON .days[" + d + "].slots must be an array");
    }
    const slots = day.slots.map((slot, s) => {
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
        throw new TypeError(".days[" + d + "].slots[" + s + "] must be an object");
      }
      assertRecipeId(slot.recipeId);
      const servings =
        slot.servings == null ? null : (assertServings(slot.servings), slot.servings);
      return { recipeId: slot.recipeId, servings };
    });
    return { label, slots };
  });
  return { days, slots: [] };
}
