// listView.mjs — merged shopping list with sections, check-off, staples.

import { h, clear } from "../dom.mjs";
import {
  getState, setState, subscribe, getListChecks, toggleListCheck,
  resetListChecks, updateSettings,
} from "../state.mjs";
import { buildShoppingList, DEFAULT_STAPLES, SECTIONS_ORDER } from "../../core/shoppingList.mjs";
import { planToShoppingInputs } from "../../core/planner.mjs";
import { formatQuantity, formatQuantityRange } from "../../core/format.mjs";
import { makeFraction } from "../../core/fraction.mjs";

function currentSystem() {
  return (getState().settings || {}).unitsSystem ?? null;
}

function staplesList() {
  const s = (getState().settings || {}).staples;
  return Array.isArray(s) && s.length ? s : [...DEFAULT_STAPLES];
}

// Picker state survives view remounts (mode toggles, servings edits) so a
// half-built list is never silently forgotten.
const includeIds = new Set();
const servingsOverrides = new Map();

export function listView(container, params) {
  let source = params && params.query && params.query.get("src") === "plan" ? "plan" : "picked";
  let excludeStaples = true;

  function recipes() {
    return getState().recipes;
  }

  function inputsForBuild() {
    if (source === "plan") {
      const byId = Object.fromEntries(recipes().map((r) => [r.id, r]));
      return planToShoppingInputs(getState().plan || { days: [] }, byId);
    }
    const out = [];
    for (const r of recipes()) {
      if (!includeIds.has(r.id)) continue;
      const servings = servingsOverrides.get(r.id) || (r.yield && r.yield.serves) || null;
      out.push({ recipe: r, servings });
    }
    return out;
  }

  function buildList() {
    try {
      return buildShoppingList(inputsForBuild(), {
        excludeStaples,
        staples: staplesList(),
        system: currentSystem(),
      });
    } catch (err) {
      return { groups: [], hiddenStaples: 0, error: String(err.message || err) };
    }
  }

  function qtyText(item) {
    return item.quantities
      .map((q) => {
        if (!q.amount || !q.unit) return "";
        return formatQuantity({ amount: q.amount, unit: q.unit }, { system: currentSystem() }).text;
      })
      .filter(Boolean)
      .join(" + ");
  }

  function renderBody(body) {
    clear(body);
    if (body.dataset.error) {
      body.append(h("div", { class: "banner-error" }, body.dataset.error));
    }
    const checks = getListChecks();
    let total = 0;
    let ticked = 0;

    for (const group of list.groups) {
      const itemsUl = h("ul", { class: "list-items" });
      for (const item of group.items) {
        total += 1;
        const checked = !!checks[item.key];
        if (checked) ticked += 1;
        const notes = (item.notes || []).concat(
          item.preparations && item.preparations.length ? ["preparation: " + item.preparations.join(" / ")] : []
        );
        itemsUl.append(
          h("li", {},
            h("label", { class: "list-item" + (checked ? " checked" : "") },
              h("input", {
                type: "checkbox",
                ...(checked ? { checked: true } : {}),
                onchange: () => {
                  toggleListCheck(item.key);
                  summary.textContent =
                    countText();
                },
              }),
              h("span", { class: "item-qty" }, qtyText(item)),
              h("span", { class: "item-name" }, item.displayName)),
            notes.length
              ? h("ul", { class: "item-notes" }, notes.map((n) => h("li", {}, n)))
              : null)
        );
      }
      body.append(
        h("section", { "aria-labelledby": "sec-" + slug(group.section) },
          h("h3", { class: "section-heading", id: "sec-" + slug(group.section) },
            group.section + " (" + group.items.length + ")"),
          itemsUl)
      );
    }

    summary.textContent = countText();

    function countText() {
      return tickedNow() + " of " + total + " ticked";
    }
    function tickedNow() {
      const c = getListChecks();
      let n = 0;
      for (const g of list.groups) for (const it of g.items) if (c[it.key]) n += 1;
      return String(n);
    }

    if (excludeStaples && list.hiddenStaples > 0) {
      body.append(
        h("p", { class: "staples-footer muted" },
          list.hiddenStaples + " pantry staple" + (list.hiddenStaples === 1 ? "" : "s") + " hidden")
      );
    }
    if (!list.groups.length) {
      body.append(
        h("div", { class: "empty-state" },
          h("p", {}, "Nothing on the list yet. Pick recipes above or plan the week first."),
          h("a", { class: "btn btn-primary", href: "#/planner" }, "Open the planner"))
      );
    }
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z]+/g, "-");
  }

  const summary = h("p", { class: "muted", "aria-live": "polite" });
  const body = h("div", {});

  function selectorPanel() {
    const panel = h("fieldset", { class: "list-source no-print" },
      h("legend", {}, "What are we shopping for?"));
    const modeRow = h("div", { class: "btn-row" },
      h("button", {
        class: "btn" + (source === "picked" ? " btn-primary" : ""),
        type: "button",
        onclick: () => { source = "picked"; refresh(); },
      }, "Chosen recipes"),
      h("button", {
        class: "btn" + (source === "plan" ? " btn-primary" : ""),
        type: "button",
        onclick: () => { source = "plan"; refresh(); },
      }, "From planner"));
    panel.append(modeRow);

    if (source === "picked") {
      const ul = h("ul", { class: "picker-list" });
      for (const r of recipes()) {
        const input = h("input", {
          type: "checkbox",
          "aria-label": "Include " + r.title,
          ...(includeIds.has(r.id) ? { checked: true } : {}),
          onchange: () => {
            if (input.checked) includeIds.add(r.id);
            else includeIds.delete(r.id);
            rebuild();
          },
        });
        const serv = h("input", {
          type: "number",
          min: "1",
          step: "1",
          "aria-label": "Servings for " + r.title,
          value: String(servingsOverrides.get(r.id) || (r.yield && r.yield.serves) || ""),
          oninput: () => {
            const v = parseInt(serv.value, 10);
            if (Number.isInteger(v) && v > 0) servingsOverrides.set(r.id, v);
            scheduleRebuild();
          },
        });
        ul.append(h("li", {}, h("label", {}, input, " ", r.title), " ", serv));
      }
      panel.append(ul);
    } else {
      const plan = getState().plan;
      const slotCount = plan && plan.days ? plan.days.reduce((n, d) => n + (d.slots ? d.slots.length : 0), 0) : 0;
      panel.append(h("p", { class: "muted" },
        slotCount ? slotCount + " planned meal slot(s)." : "The planner is empty — add meals first."));
    }

    const staplesToggle = h("input", {
      type: "checkbox",
      ...(excludeStaples ? { checked: true } : {}),
      onchange: () => { excludeStaples = staplesToggle.checked; rebuild(); },
    });
    const cur = currentSystem();
    units = h("select", {
      onchange: () => {
        updateSettings({ unitsSystem: units.value === "auto" ? null : units.value });
        rebuild();
      },
    },
      h("option", { value: "auto" }, "Auto"),
      h("option", { value: "metric" }, "Metric"),
      h("option", { value: "imperial" }, "Imperial"));
    units.value = cur || "auto";
    panel.append(
      h("label", { class: "inline-label" }, staplesToggle, " Hide pantry staples"),
      h("label", { class: "inline-label" }, "Units ", units)
    );
    return panel;
  }

  let units; // assigned inside selectorPanel select construction

  const toolbar = h("div", { class: "btn-row no-print" },
    summary,
    h("button", {
      class: "btn",
      type: "button",
      onclick: () => { resetListChecks(); rebuild(); },
    }, "Reset ticks"),
    h("button", { class: "btn", type: "button", onclick: () => printList() }, "Print"),
    h("button", { class: "btn", type: "button", onclick: () => downloadMarkdown() }, "Export markdown"));

  container.append(
    h("header", {},
      h("h1", {}, "Shopping list")),
    toolbar,
    selectorPanel(),
    body);

  let list = buildList();
  let rebuildTimer = null;
  function scheduleRebuild() {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => { rebuildTimer = null; rebuild(); }, 200);
  }
  function rebuild() {
    list = buildList();
    if (list.error) body.dataset.error = list.error;
    else delete body.dataset.error;
    renderBody(body);
  }
  function refresh() {
    // full re-mount keeps the selector panel simple; run our own cleanup
    // first so subscribers/timers never stack across remounts
    if (cleanupFn) cleanupFn();
    mountAgain();
  }
  function printList() {
    document.body.classList.add("print-list");
    window.print();
    window.addEventListener("afterprint", () => document.body.classList.remove("print-list"), { once: true });
  }
  function downloadMarkdown() {
    const lines = ["# Shopping list", ""];
    for (const g of list.groups) {
      lines.push("## " + g.section);
      for (const it of g.items) {
        lines.push("- [ ] " + (qtyText(it) ? qtyText(it) + " " : "") + it.displayName);
        for (const n of it.notes || []) lines.push("    - " + n);
      }
      lines.push("");
    }
    if (list.hiddenStaples) lines.push("_" + list.hiddenStaples + " pantry staples hidden_");
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "panfare-shopping-list.md";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function mountAgain() {
    clear(container);
    listView(container);
  }

  const unsub = subscribe(() => { /* check toggles re-render via renderBody only */ });

  rebuild();

  let cleanupFn = null;
  cleanupFn = function () {
    unsub();
    if (rebuildTimer) clearTimeout(rebuildTimer);
    cleanupFn = null;
  };

  return function cleanup() {
    if (cleanupFn) cleanupFn();
  };
}
