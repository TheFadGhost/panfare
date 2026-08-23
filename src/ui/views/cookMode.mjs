// cookMode.mjs — one step at a time, large type, screen wake, timers.

import { h, clear } from "../dom.mjs";
import { getState, getRecipe, getScale, upsertRecipe } from "../state.mjs";
import { scaleRecipe, parseStepTimers } from "../../core/scaling.mjs";
import { formatQuantity, pickDisplayUnit, roundMetricBase } from "../../core/format.mjs";
import { makeFraction } from "../../core/fraction.mjs";
import { applyTheme } from "../../styles/tokens.mjs";
import { navigate } from "../router.mjs";

function mmss(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

export function cookView(container, params) {
  const recipe = getRecipe(params.id);
  const previousThemeSetting = (getState().settings || {}).theme || null;
  let disposed = false;
  let wakeLock = null;
  const timers = new Map(); // id -> interval
  let timerSeq = 0;

  if (!recipe) {
    container.append(
      h("section", { class: "empty-state" },
        h("h2", {}, "Nothing to cook"),
        h("p", {}, "That recipe isn’t in your library."),
        h("a", { class: "btn btn-primary", href: "#/library" }, "Back to the library"))
    );
    return;
  }

  document.body.classList.add("cooking");
  applyTheme("contrast");

  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch {
      wakeLock = null; // silent per DESIGN.md
    }
  }
  acquireWakeLock();

  const onVisibility = () => {
    if (document.visibilityState === "visible" && !disposed && wakeLock === null) {
      acquireWakeLock();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const factor = getScale(recipe.id) || makeFraction(1);
  const scaled = scaleRecipe(recipe, factor);
  const steps = scaled.steps.map((s) => s.text);

  let index = 0;

  const progressEl = h("p", { class: "cook-progress", "aria-live": "polite" });
  const stepTextEl = h("p", { class: "cook-step" });
  const timerBar = h("div", { class: "cook-timers" });
  const banner = h("div", { class: "banner-ok", hidden: true }, "");
  const aside = h("aside", { class: "cook-ingredients", hidden: true });

  function ingredientRows() {
    const list = h("ul", { class: "ingredient-list" });
    for (const line of scaled.ingredients) {
      if (!line.quantity || !line.unit) continue;
      const picked = pickDisplayUnit(line.quantity, line.unit, {});
      const rounded =
        picked.unitId === "ml" || picked.unitId === "g"
          ? roundMetricBase(picked.amount)
          : { value: picked.amount, approx: false };
      const r = formatQuantity({ amount: rounded.value, unit: picked.unitId });
      list.append(h("li", { class: "ingredient-row" },
        h("span", { class: "ingredient-qty", "aria-label": r.aria }, r.text),
        h("span", { class: "ingredient-item" },
          line.item,
          line.preparation ? h("em", { class: "prep" }, " — " + line.preparation) : null)
      ));
    }
    return list;
  }

  function announce(msg) {
    banner.hidden = false;
    banner.textContent = msg;
  }

  function renderTimersForStep(stepIdx) {
    clear(timerBar);
    const text = steps[stepIdx] || "";
    const parsed = parseStepTimers(text);
    parsed.forEach((t) => {
      const id = ++timerSeq;
      const label = t.label + (t.range ? " (range)" : "");
      const chip = h("button", {
        class: "timer-chip btn",
        type: "button",
        "aria-label": "Start timer " + label + " for " + mmss(t.seconds),
        onclick: () => startTimer(id, label, t.seconds, chip),
      }, "Start " + label + " · " + mmss(t.seconds));
      timerBar.append(chip);
    });
  }

  function startTimer(id, label, seconds, chip) {
    const endAt = Date.now() + seconds * 1000;
    chip.setAttribute("aria-label", label + " running");
    const interval = setInterval(() => {
      const remaining = Math.round((endAt - Date.now()) / 1000);
      if (remaining <= 0) {
        clearInterval(interval);
        chip.textContent = "Done · " + label;
        chip.disabled = true;
        announce("Timer done — " + label);
      } else {
        chip.textContent = mmss(remaining) + " · " + label;
      }
    }, 250);
    timers.set(id, { interval, chip });
    chip.textContent = mmss(seconds) + " · " + label;
  }

  function renderStep() {
    progressEl.textContent = "Step " + (index + 1) + " of " + steps.length;
    stepTextEl.textContent = steps[index] || "";
    renderTimersForStep(index);
    banner.hidden = true;
    prevBtn.disabled = index === 0;
    nextBtn.textContent = index === steps.length - 1 ? "Finish" : "Next";
    if (!aside.hidden) {
      clear(aside);
      aside.append(h("h3", {}, "Ingredients"), ingredientRows());
    }
  }

  function go(delta) {
    if (index + delta >= steps.length) {
      finishFlow();
      return;
    }
    index = Math.max(0, index + delta);
    renderStep();
  }

  function finishFlow() {
    clear(container);
    const now = new Date().toISOString();
    const entry = { date: now, scale: factor.n + "/" + factor.d };
    let rating = null;
    const stars = [1, 2, 3, 4, 5].map((n) =>
      h("button", {
        class: "btn rate-btn",
        type: "button",
        "aria-label": n + " of 5",
        onclick: () => {
          rating = n;
          for (const b of stars) b.setAttribute("aria-pressed", String(Number(b.textContent) <= n));
        },
      }, String(n))
    );
    container.append(
      h("section", { class: "empty-state" },
        h("h2", {}, "Cooked it?"),
        h("p", {}, "This adds an entry to the recipe’s history."),
        h("div", { class: "rate-row", role: "group", "aria-label": "Rating" }, stars),
        h("div", { class: "btn-row" },
          h("button", {
            class: "btn btn-primary",
            type: "button",
            onclick: () => {
              upsertRecipe({
                ...recipe,
                history: [...(recipe.history || []), entry],
                rating: rating || recipe.rating || null,
              });
              exit();
            },
          }, "Save and close"),
          h("button", { class: "btn", type: "button", onclick: () => exit() }, "Close without saving")))
    );
  }

  function exit() {
    navigate("#/recipe/" + recipe.id);
  }

  const prevBtn = h("button", { class: "btn cook-nav", type: "button", onclick: () => go(-1) }, "Back");
  const nextBtn = h("button", { class: "btn btn-primary cook-nav", type: "button", onclick: () => go(1) }, "Next");
  const ingToggle = h("button", {
    class: "btn",
    type: "button",
    "aria-expanded": "false",
    onclick: () => {
      aside.hidden = !aside.hidden;
      ingToggle.setAttribute("aria-expanded", String(!aside.hidden));
      if (!aside.hidden) {
        clear(aside);
        aside.append(h("h3", {}, "Ingredients"), ingredientRows());
      }
    },
  }, "Ingredients");

  const onKey = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    else if (e.key === "Escape") { e.preventDefault(); exit(); }
  };
  document.addEventListener("keydown", onKey);

  container.append(
    h("section", { class: "cook-mode" },
      h("header", { class: "cook-header no-print" },
        h("a", { href: "#/recipe/" + recipe.id, class: "btn" }, "Exit"),
        h("strong", {}, recipe.title),
        ingToggle),
      progressEl,
      banner,
      stepTextEl,
      timerBar,
      aside,
      h("div", { class: "cook-controls no-print" }, prevBtn, nextBtn))
  );

  renderStep();

  return function cleanup() {
    disposed = true;
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisibility);
    document.body.classList.remove("cooking");
    for (const t of timers.values()) clearInterval(t.interval);
    timers.clear();
    try { if (wakeLock) wakeLock.release(); } catch { /* already released */ }
    wakeLock = null;
    if (previousThemeSetting && ["light", "dark", "contrast"].includes(previousThemeSetting)) {
      applyTheme(previousThemeSetting);
    }
  };
}
