// plannerView.mjs — week grid; feeds the shopping list.

import { h, clear } from "../dom.mjs";
import { getState, setState, subscribe } from "../state.mjs";
import { DAY_LABELS, assignSlot, removeSlot } from "../../core/planner.mjs";

function ensurePlan(state) {
  if (state.plan && Array.isArray(state.plan.days) && state.plan.days.length === 7) {
    return state.plan;
  }
  return {
    days: DAY_LABELS.map((label) => ({ label, slots: [] })),
  };
}

function lastCooked(recipe) {
  const hist = recipe.history || [];
  if (!hist.length) return null;
  const last = hist[hist.length - 1];
  const then = new Date(last.date);
  if (isNaN(then)) return null;
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return "cooked today";
  if (days === 1) return "cooked yesterday";
  if (days < 30) return "cooked " + days + " days ago";
  const months = Math.floor(days / 30);
  return "cooked " + months + " month" + (months === 1 ? "" : "s") + " ago";
}

function defaultServingsFor(recipeId) {
  const r = getState().recipes.find((x) => x.id === recipeId);
  const s = r && r.yield && r.yield.serves;
  return Number.isInteger(s) && s > 0 ? s : 1;
}

export function plannerView(container) {
  function recipes() {
    return (getState().recipes || []).slice().sort((a, b) => a.title.localeCompare(b.title));
  }

  function persist(nextPlan) {
    setState({ ...getState(), plan: nextPlan });
  }

  let grid;

  function slotEl(dayIdx, slotIdx, slot, plan) {
    const recipe = getState().recipes.find((r) => r.id === slot.recipeId);
    const select = h("select", {
      "aria-label": "Recipe",
      onchange: () => {
        if (!select.value) return;
        const parsed = parseInt(servInput.value, 10);
        const next = assignSlot(plan, dayIdx, slotIdx, {
          recipeId: select.value,
          servings: Number.isInteger(parsed) && parsed > 0 ? parsed : defaultServingsFor(select.value),
        });
        persist(next);
      },
    },
      h("option", { value: "" }, "Choose a recipe…"),
      recipes().map((r) => h("option", { value: r.id }, r.title)));
    if (recipe) select.value = recipe.id;

    const servInput = h("input", {
      type: "number",
      min: "1",
      step: "1",
      "aria-label": "Servings",
      value: String(slot.servings || (recipe && recipe.yield && recipe.yield.serves) || ""),
      oninput: () => {
        const v = parseInt(servInput.value, 10);
        if (!Number.isInteger(v) || v <= 0) return;
        const next = assignSlot(plan, dayIdx, slotIdx, { recipeId: slot.recipeId, servings: v });
        // assignSlot replaces the whole slot; keep position stable
        persist(next);
      },
    });

    const meta = [];
    if (recipe) {
      const mins = ((recipe.times && recipe.times.prep) || 0) + ((recipe.times && recipe.times.cook) || 0);
      if (mins) meta.push(mins + " min");
      const cooked = lastCooked(recipe);
      if (cooked) meta.push(cooked);
    }

    return h("li", { class: "slot" },
      h("div", { class: "slot-controls" }, select, servInput),
      recipe
        ? h("a", { class: "slot-title", href: "#/recipe/" + recipe.id }, recipe.title)
        : h("span", { class: "slot-title muted" }, ""),
      meta.length ? h("p", { class: "muted slot-meta" }, meta.join(" · ")) : null,
      h("button", {
        class: "btn btn-small",
        type: "button",
        "aria-label": "Remove slot",
        onclick: () => persist(removeSlot(plan, dayIdx, slotIdx)),
      }, "Remove"));
  }

  function renderGrid(plan) {
    clear(grid);
    grid.append(...plan.days.map((day, dayIdx) => {
      const slotsUl = h("ul", { class: "slots" },
        day.slots.map((slot, i) => slotEl(dayIdx, i, slot, plan)));
      const addBtn = h("button", {
        class: "btn btn-small",
        type: "button",
        onclick: () => {
          addBtn.hidden = true;
          const sel = h("select", { "aria-label": "Recipe to add" },
            h("option", { value: "" }, "Choose a recipe…"),
            recipes().map((r) => h("option", { value: r.id }, r.title)));
          const serv = h("input", {
            type: "number", min: "1", step: "1", "aria-label": "Servings",
            placeholder: "servings",
          });
          const draft = h("li", { class: "slot draft" },
            h("div", { class: "slot-controls" }, sel, serv),
            h("div", { class: "btn-row" },
              h("button", {
                class: "btn btn-small btn-primary",
                type: "button",
                onclick: () => {
                  if (!sel.value) return;
                  const v = parseInt(serv.value, 10);
                  persist(assignSlot(plan, dayIdx, null, {
                    recipeId: sel.value,
                    servings: Number.isInteger(v) && v > 0 ? v : defaultServingsFor(sel.value),
                  }));
                },
              }, "Add"),
              h("button", {
                class: "btn btn-small",
                type: "button",
                onclick: () => { draft.remove(); addBtn.hidden = false; },
              }, "Cancel")));
          slotsUl.append(draft);
          sel.focus();
        },
      }, "+ Add meal");
      return h("section", { class: "plan-day", "aria-label": day.label },
        h("h3", {}, day.label),
        slotsUl,
        addBtn);
    }));
  }

  const header = h("header", {},
    h("h1", {}, "This week"),
    h("div", { class: "btn-row" },
      h("a", { class: "btn btn-primary", href: "#/list?src=plan" }, "Build shopping list from plan")));

  grid = h("div", { class: "plan-grid" });

  container.append(header, grid);

  function rerender() {
    renderGrid(ensurePlan(getState()));
  }
  const unsub = subscribe(() => rerender());
  rerender();

  return function cleanup() {
    unsub();
  };
}
