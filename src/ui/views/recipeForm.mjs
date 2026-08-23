// recipeFormView.mjs — create and edit recipes.
//
// Route handling: app.mjs registers only "#/recipe/:id", so the form lives
// behind "#/recipe/new" (create) and "#/recipe/edit:<id>" (edit). Any other
// id that resolves to a stored recipe is treated as an edit.
//
// Ingredient lines are parsed with core/parser and stay editable; uncertain
// lines must be fixed or explicitly kept ("Keep anyway") before saving.
// Quantities are Fractions end to end; nothing is ever converted to a float.

import { h } from "../dom.mjs";
import { getRecipe, upsertRecipe } from "../state.mjs";
import { parseIngredientLines, parseIngredientLine } from "../../core/parser.mjs";
import { numberTokenToFraction } from "../../core/scaling.mjs";
import { resolveUnit, registerCountUnit } from "../../core/units.mjs";

const MAX_PHOTO_EDGE = 512;
const PHOTO_WARN_BYTES = 300 * 1024;

function fractionInputText(frac) {
  if (!frac) return "";
  return frac.d === 1 ? String(frac.n) : frac.n + "/" + frac.d;
}

function parseQtyText(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return { value: null };
  try {
    const f = numberTokenToFraction(t);
    if (f && f.n > 0) return { value: f };
  } catch {
    return { error: true };
  }
  return { error: true };
}

function resolveUnitInput(text) {
  const token = String(text || "").trim();
  if (!token) return null;
  const direct = resolveUnit(token);
  if (direct) return direct;
  if (/^[a-z-]+$/i.test(token)) return registerCountUnit(token.replace(/s$/, "").toLowerCase());
  return null;
}

function rowFromParsed(parsed) {
  return {
    key: "k" + Math.random().toString(36).slice(2),
    id: null,
    rawOriginal: parsed.raw || "",
    qtyText: fractionInputText(parsed.quantity),
    quantityMax: parsed.quantityMax || null,
    unitText: parsed.unit ? String(parsed.unit) : "",
    item: parsed.item || "",
    prep: parsed.preparation || "",
    sub: parsed.substitute || "",
    uncertain: !!parsed.uncertain,
    reason: parsed.uncertaintyReason || null,
    keep: false,
  };
}

export function recipeForm(container, params) {
  let disposed = false;

  const rawId = (params && params.id) || "new";
  let editing = null;
  if (rawId !== "new") {
    const candidate = decodeURIComponent(
      rawId.startsWith("edit:") ? rawId.slice(5) : rawId
    );
    editing = getRecipe(candidate);
  }

  if (rawId !== "new" && !editing) {
    container.append(
      h(
        "section",
        { class: "empty-state" },
        h("h2", { class: "empty-state__title" }, "That recipe is gone."),
        h("p", {}, "There is nothing to edit here."),
        h("a", { class: "btn btn-primary", href: "#/library" }, "Back to the library")
      )
    );
    return function cleanup() {};
  }

  // ---- model ------------------------------------------------------------------

  const existingLinesById = new Map();
  for (const line of Array.isArray(editing && editing.ingredients) ? editing.ingredients : []) {
    if (line && line.id != null) existingLinesById.set(String(line.id), line);
  }

  const model = {
    title: editing ? editing.title || "" : "",
    servesText:
      editing && editing.yield && typeof editing.yield.serves === "number"
        ? String(editing.yield.serves)
        : "",
    yieldText:
      editing && editing.yield && typeof editing.yield.text === "string"
        ? editing.yield.text
        : "",
    prepText:
      editing && editing.times && typeof editing.times.prep === "number"
        ? String(editing.times.prep)
        : "",
    cookText:
      editing && editing.times && typeof editing.times.cook === "number"
        ? String(editing.times.cook)
        : "",
    tags: Array.isArray(editing && editing.tags) ? editing.tags.join(", ") : "",
    notes: editing && typeof editing.notes === "string" ? editing.notes : "",
    srcUrl: (editing && editing.source && editing.source.url) || "",
    srcTitle: (editing && editing.source && editing.source.title) || "",
    srcAuthor: (editing && editing.source && editing.source.author) || "",
    photo: (editing && editing.photo) || null,
    ingRows: [],
    steps: [],
  };

  for (const line of Array.isArray(editing && editing.ingredients) ? editing.ingredients : []) {
    model.ingRows.push({
      key: "k" + Math.random().toString(36).slice(2),
      id: line.id || null,
      rawOriginal: line.raw || "",
      qtyText: fractionInputText(line.quantity),
      quantityMax: line.quantityMax || null,
      unitText: line.unit || "",
      item: line.item || "",
      prep: line.preparation || "",
      sub: line.substitute || "",
      uncertain: !!line.uncertain,
      reason: line.uncertaintyReason || null,
      keep: !!line.uncertain,
    });
  }
  if (!model.ingRows.length) model.ingRows.push(newBlankRow());

  model.steps = (Array.isArray(editing && editing.steps) ? editing.steps : [])
    .map((s) => (s && typeof s.text === "string" ? s.text : ""))
    .filter((t) => t.trim().length > 0);

  let dirty = false;
  const markDirty = () => {
    dirty = true;
  };

  // ---- static skeleton ----------------------------------------------------------

  const errTitleId = "pf-err-title";
  const errIngId = "pf-err-ing";
  const errStepsId = "pf-err-steps";
  const errTitle = h("span", { id: errTitleId, class: "field-message", hidden: true });
  const errIng = h("span", { id: errIngId, class: "field-message", hidden: true });
  const errSteps = h("span", { id: errStepsId, class: "field-message", hidden: true });

  const titleInput = h("input", {
    type: "text",
    id: "pf-f-title",
    value: model.title,
    "aria-describedby": errTitleId,
    required: true,
  });

  const servesInput = h("input", {
    type: "number",
    min: 1,
    step: 1,
    value: model.servesText,
    "aria-label": "Serves",
    style: "width:8rem;",
  });
  const yieldTextInput = h("input", {
    type: "text",
    id: "pf-f-yieldtext",
    value: model.yieldText,
    placeholder: "e.g. makes 2 loaves",
  });

  const prepInput = h("input", {
    type: "number",
    min: 0,
    step: 1,
    value: model.prepText,
    "aria-label": "Preparation minutes",
    style: "width:8rem;",
  });
  const cookInput = h("input", {
    type: "number",
    min: 0,
    step: 1,
    value: model.cookText,
    "aria-label": "Cook minutes",
    style: "width:8rem;",
  });

  const tagsInput = h("input", {
    type: "text",
    id: "pf-f-tags",
    value: model.tags,
    placeholder: "soup, vegan, weeknight",
  });

  const notesInput = h("textarea", { id: "pf-f-notes", rows: 3 }, model.notes);

  function sourceField(value, label, id) {
    const locked = !!value; // prefilled attribution is preserved, not edited
    return h("input", {
      type: label === "Source URL" ? "url" : "text",
      id,
      value,
      readonly: locked,
      "aria-label": label + (locked ? " (kept from the original source)" : ""),
    });
  }
  const srcUrlInput = sourceField(model.srcUrl, "Source URL", "pf-f-srcurl");
  const srcTitleInput = sourceField(model.srcTitle, "Source title", "pf-f-srctitle");
  const srcAuthorInput = sourceField(model.srcAuthor, "Source author", "pf-f-srcauthor");
  const sourceHint =
    model.srcUrl || model.srcTitle || model.srcAuthor
      ? h("span", { class: "field-hint" }, "Attribution is kept from the original source.")
      : null;

  // ---- photo ---------------------------------------------------------------------

  const photoPreview = h("img", {
    alt: "Photo preview",
    style:
      "display:" + (model.photo ? "block" : "none") +
      ";max-height:200px;width:auto;margin-top:12px;border-radius:6px;border:1px solid var(--pf-line,#e4dcce);",
  });
  if (model.photo) photoPreview.src = model.photo;
  const photoWarn = h("span", { class: "field-message", hidden: true });
  const photoError = h("span", { class: "field-message", hidden: true });
  const photoFile = h("input", {
    type: "file",
    accept: "image/*",
    "aria-label": "Recipe photo",
    style: "padding:8px 0;",
  });
  const photoRemove = h(
    "button",
    { class: "btn", type: "button", style: "display:" + (model.photo ? "" : "none") + ";" },
    "Remove photo"
  );

  photoFile.addEventListener("change", () => {
    const file = photoFile.files && photoFile.files[0];
    if (!file) return;
    photoError.hidden = true;
    const reader = new FileReader();
    reader.onerror = () => {
      photoError.textContent = "That file could not be read as an image.";
      photoError.hidden = false;
    };
    reader.onload = () => {
      if (disposed) return;
      const img = new Image();
      img.onerror = () => {
        photoError.textContent = "That file could not be read as an image.";
        photoError.hidden = false;
      };
      img.onload = () => {
        if (disposed) return;
        const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const hh = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = hh;
        canvas.getContext("2d").drawImage(img, 0, 0, w, hh);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        model.photo = dataUrl;
        markDirty();
        photoPreview.src = dataUrl;
        photoPreview.style.display = "block";
        photoRemove.style.display = "";
        const bytes = Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
        if (bytes > PHOTO_WARN_BYTES) {
          photoWarn.textContent =
            "The resized photo is still about " + Math.round(bytes / 1024) + " KB. A smaller image keeps the library quick.";
          photoWarn.hidden = false;
        } else {
          photoWarn.hidden = true;
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  photoRemove.addEventListener("click", () => {
    model.photo = null;
    markDirty();
    photoFile.value = "";
    photoPreview.removeAttribute("src");
    photoPreview.style.display = "none";
    photoRemove.style.display = "none";
    photoWarn.hidden = true;
  });

  // ---- ingredients editor -----------------------------------------------------------

  const bulkInput = h("textarea", {
    placeholder: "One ingredient per line, e.g.\n200 g plain flour\n2 eggs, beaten",
    "aria-label": "Paste ingredients, one per line",
  });
  const ingRowsRegion = h("div", {});
  const addLineInput = h("input", {
    type: "text",
    placeholder: "e.g. 200 g plain flour, sifted",
    "aria-label": "Add one ingredient line",
  });

  function newBlankRow() {
    return {
      key: "k" + Math.random().toString(36).slice(2),
      id: null,
      rawOriginal: "",
      qtyText: "",
      quantityMax: null,
      unitText: "",
      item: "",
      prep: "",
      sub: "",
      uncertain: false,
      reason: null,
      keep: false,
    };
  }

  function rowInput(row, field, label, placeholder) {
    return h("input", {
      type: "text",
      value: row[field],
      placeholder,
      "aria-label": label,
      dataset: { key: row.key, field },
      oninput: (e) => {
        const target = model.ingRows.find((r) => r.key === row.key);
        if (!target) return;
        target[field] = e.target.value;
        if (field === "qtyText" || field === "unitText" || field === "item") {
          target.uncertain = false;
          target.reason = null;
          e.target.removeAttribute("aria-invalid");
          const wrapper = e.target.closest(".pf-ing-row");
          if (wrapper) refreshRowFlags(wrapper, target);
        }
        markDirty();
      },
    });
  }

  function refreshRowFlags(wrapper, row) {
    const flagBox = wrapper.querySelector(".pf-row-flags");
    flagBox.textContent = "";
    if (!row.uncertain) {
      wrapper.style.borderLeft = "";
      wrapper.style.background = "";
      return;
    }
    wrapper.style.borderLeft = "4px solid var(--pf-warn-text, #6b4a12)";
    wrapper.style.background = "var(--pf-warn-bg, #f6ebd4)";
    flagBox.append(
      h(
        "span",
        { class: "prep", style: "margin-right:16px;" },
        "Check this line (" + (row.reason || "unclear") + "): " + (row.rawOriginal || row.item)
      ),
      h(
        "label",
        { style: "display:inline-flex;gap:8px;align-items:center;" },
        h("input", {
          type: "checkbox",
          checked: row.keep,
          dataset: { key: row.key, field: "keep" },
          onchange: (e) => {
            const target = model.ingRows.find((r) => r.key === row.key);
            if (target) target.keep = e.target.checked;
            markDirty();
          },
        }),
        "Keep anyway"
      )
    );
  }

  function moveRow(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= model.ingRows.length) return;
    const [row] = model.ingRows.splice(index, 1);
    model.ingRows.splice(to, 0, row);
    markDirty();
    rebuildIngRows(to, "item");
  }

  function removeRow(index) {
    model.ingRows.splice(index, 1);
    if (!model.ingRows.length) model.ingRows.push(newBlankRow());
    markDirty();
    rebuildIngRows(Math.max(0, index - 1), "item");
  }

  function buildRowEl(row, index) {
    const wrapper = h("div", {
      class: "pf-ing-row",
      style:
        "display:grid;grid-template-columns:5rem 7rem 1fr 1fr 1fr auto;gap:8px;" +
        "align-items:start;padding:8px 12px;border-radius:6px;",
    });
    wrapper.append(
      rowInput(row, "qtyText", "Ingredient " + (index + 1) + " quantity", "1 1/2"),
      rowInput(row, "unitText", "Ingredient " + (index + 1) + " unit", "cup"),
      rowInput(row, "item", "Ingredient " + (index + 1) + " name", "plain flour"),
      rowInput(row, "prep", "Ingredient " + (index + 1) + " preparation", "sifted"),
      rowInput(row, "sub", "Ingredient " + (index + 1) + " substitute", "or bread flour"),
      h(
        "div",
        { style: "display:flex;gap:4px;" },
        h(
          "button",
          {
            class: "btn", type: "button", "aria-label": "Move ingredient up",
            disabled: index === 0,
            onclick: () => moveRow(index, -1),
          },
          "Up"
        ),
        h(
          "button",
          {
            class: "btn", type: "button", "aria-label": "Move ingredient down",
            disabled: index === model.ingRows.length - 1,
            onclick: () => moveRow(index, 1),
          },
          "Down"
        ),
        h(
          "button",
          { class: "btn", type: "button", "aria-label": "Remove ingredient", onclick: () => removeRow(index) },
          "Remove"
        )
      ),
      h("div", { class: "pf-row-flags", style: "grid-column:1 / -1;display:flex;align-items:center;flex-wrap:wrap;gap:8px;" })
    );
    refreshRowFlags(wrapper, row);
    if (row.uncertain && !row.keep) {
      const qtyField = wrapper.querySelector('input[data-field="qtyText"]');
      if (qtyField && row.qtyText) qtyField.setAttribute("aria-invalid", "true");
    }
    return wrapper;
  }

  function rebuildIngRows(focusIndex, focusField) {
    ingRowsRegion.textContent = "";
    model.ingRows.forEach((row, index) => ingRowsRegion.append(buildRowEl(row, index)));
    if (focusIndex != null) {
      const el = ingRowsRegion.querySelector(
        '.pf-ing-row:nth-child(' + (focusIndex + 1) + ') input[data-field="' + focusField + '"]'
      );
      if (el) el.focus();
    }
  }

  function parseBulk() {
    const parsed = parseIngredientLines(bulkInput.value);
    if (!parsed.length) return;
    const firstNew = model.ingRows.length;
    for (const p of parsed) model.ingRows.push(rowFromParsed(p));
    bulkInput.value = "";
    markDirty();
    rebuildIngRows(firstNew, "item");
  }

  function addSingleLine() {
    const text = addLineInput.value.trim();
    if (!text) return;
    model.ingRows.push(rowFromParsed(parseIngredientLine(text)));
    addLineInput.value = "";
    markDirty();
    rebuildIngRows(model.ingRows.length - 1, "item");
  }

  // ---- steps editor -----------------------------------------------------------------

  const stepsRegion = h("div", {});

  function rebuildSteps(focusIndex) {
    stepsRegion.textContent = "";
    model.steps.forEach((text, index) => {
      const ta = h("textarea", {
        rows: 2,
        value: text,
        "aria-label": "Step " + (index + 1),
        dataset: { index: String(index) },
        oninput: (e) => {
          model.steps[index] = e.target.value;
          markDirty();
        },
      });
      stepsRegion.append(
        h(
          "div",
          { style: "display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;" },
          h("div", { style: "flex:1;" }, ta),
          h(
            "div",
            { style: "display:flex;gap:4px;" },
            h("button", { class: "btn", type: "button", "aria-label": "Move step up", disabled: index === 0, onclick: () => { const [s] = model.steps.splice(index, 1); model.steps.splice(index - 1, 0, s); markDirty(); rebuildSteps(index - 1); } }, "Up"),
            h("button", { class: "btn", type: "button", "aria-label": "Move step down", disabled: index === model.steps.length - 1, onclick: () => { const [s] = model.steps.splice(index, 1); model.steps.splice(index + 1, 0, s); markDirty(); rebuildSteps(index + 1); } }, "Down"),
            h("button", { class: "btn", type: "button", "aria-label": "Remove step", onclick: () => { model.steps.splice(index, 1); markDirty(); rebuildSteps(Math.max(0, index - 1)); } }, "Remove")
          )
        )
      );
    });
    if (focusIndex != null) {
      const el = stepsRegion.querySelector('textarea[data-index="' + focusIndex + '"]');
      if (el) el.focus();
    }
  }

  // ---- validation and save ------------------------------------------------------------

  function setError(el, message) {
    if (message) {
      el.textContent = message;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  function nextLineId(usedIds) {
    let n = usedIds.size ? Math.max(...usedIds) + 1 : 1;
    while (usedIds.has(n)) n += 1;
    usedIds.add(n);
    return "i_" + String(n).padStart(3, "0");
  }

  function collectIngredients() {
    const rows = [];
    for (const row of model.ingRows) {
      const meaningful =
        row.item.trim() || row.rawOriginal.trim() || row.qtyText.trim();
      if (!meaningful) continue;
      if (row.qtyText.trim()) {
        const parsed = parseQtyText(row.qtyText);
        if (parsed.error) {
          row.uncertain = true;
          row.reason = "unparseable-amount";
          row.keep = false;
        }
      }
      rows.push(row);
    }
    return rows;
  }

  function save() {
    setError(errTitle, null);
    setError(errIng, null);
    setError(errSteps, null);

    let firstInvalid = null;

    if (!titleInput.value.trim()) {
      setError(errTitle, "Give the recipe a title.");
      titleInput.setAttribute("aria-invalid", "true");
      firstInvalid = firstInvalid || titleInput;
    } else {
      titleInput.removeAttribute("aria-invalid");
    }

    const keptRows = collectIngredients();

    for (const row of keptRows) {
      if (row.uncertain && !row.keep) {
        setError(
          errIng,
          "Some lines need attention \u2014 fix them or tick Keep anyway (for example: " +
            (row.rawOriginal || row.item) +
            ")."
        );
        firstInvalid =
          firstInvalid ||
          ingRowsRegion.querySelector('.pf-ing-row input[data-field="qtyText"][aria-invalid="true"]') ||
          ingRowsRegion.querySelector('.pf-ing-row input[data-field="item"]');
        break;
      }
    }
    if (!firstInvalid && keptRows.length === 0) {
      setError(errIng, "Add at least one ingredient.");
      firstInvalid = firstInvalid || addLineInput;
    }

    const stepTexts = model.steps.map((s) => s.trim()).filter(Boolean);
    if (stepTexts.length === 0) {
      setError(errSteps, "Add at least one step.");
      firstInvalid = firstInvalid || stepsRegion.querySelector("textarea") || null;
    }

    if (firstInvalid) {
      if (firstInvalid.focus) firstInvalid.focus();
      return;
    }

    // Build the Recipe object per CONTRACT.md.
    const usedNumericIds = new Set();
    for (const key of existingLinesById.keys()) {
      const m = /^i_(\d+)$/.exec(key);
      if (m) usedNumericIds.add(Number(m[1]));
    }

    const ingredients = keptRows.map((row) => {
      const old = row.id != null ? existingLinesById.get(String(row.id)) : null;
      const qty = parseQtyText(row.qtyText);
      const composedRaw =
        [row.qtyText.trim(), row.unitText.trim(), row.item.trim()]
          .filter(Boolean)
          .join(" ") + (row.prep.trim() ? ", " + row.prep.trim() : "");
      return {
        id: row.id || nextLineId(usedNumericIds),
        raw: row.rawOriginal || composedRaw,
        quantity: qty.value,
        quantityMax: row.quantityMax || null,
        unit: resolveUnitInput(row.unitText),
        item: row.item.trim(),
        preparation: row.prep.trim() || null,
        substitute: row.sub.trim() || null,
        sectionOverride: (old && old.sectionOverride) || null,
        staple: !!(old && old.staple),
        uncertain: row.uncertain ? true : false,
        uncertaintyReason: row.uncertain ? row.reason || null : null,
      };
    });

    const serves = parseInt(servesInput.value, 10);
    const prepMin = parseInt(prepInput.value, 10);
    const cookMin = parseInt(cookInput.value, 10);
    const yieldText = yieldTextInput.value.trim();

    const recipe = {
      id: editing ? editing.id : "r_" + Date.now().toString(36),
      title: titleInput.value.trim(),
      yield: {
        serves: Number.isInteger(serves) && serves > 0 ? serves : null,
        text: yieldText
          ? yieldText
          : Number.isInteger(serves) && serves > 0
            ? "serves " + serves
            : null,
      },
      times: {
        prep: Number.isInteger(prepMin) && prepMin >= 0 ? prepMin : null,
        cook: Number.isInteger(cookMin) && cookMin >= 0 ? cookMin : null,
        extra: (editing && editing.times && editing.times.extra) || [],
      },
      ingredients,
      steps: stepTexts.map((text) => ({ text })),
      notes: notesInput.value.trim() || null,
      tags: tagsInput.value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      source: {
        url: srcUrlInput.value.trim() || null,
        title: srcTitleInput.value.trim() || null,
        author: srcAuthorInput.value.trim() || null,
      },
      rating: editing ? editing.rating ?? null : null,
      history: (editing && editing.history) || [],
      photo: model.photo || null,
      createdAt: editing ? editing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    upsertRecipe(recipe);
    dirty = false;
    location.hash = "#/recipe/" + encodeURIComponent(recipe.id);
  }

  function cancel() {
    if (dirty && !window.confirm("Discard your changes?")) return;
    dirty = false;
    location.hash = editing ? "#/recipe/" + encodeURIComponent(editing.id) : "#/library";
  }

  // ---- assemble -----------------------------------------------------------------------

  const form = h(
    "form",
    {
      class: "recipe-form no-print",
      style: "max-width:720px;",
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        save();
      },
    },
    h("h1", {}, editing ? "Edit recipe" : "New recipe"),

    h(
      "div",
      { class: "field" },
      h("label", { for: "pf-f-title" }, "Title"),
      titleInput,
      errTitle
    ),

    h(
      "div",
      { class: "field" },
      h("label", { for: "pf-f-yieldtext" }, "Yield"),
      h("div", { style: "display:flex;gap:12px;flex-wrap:wrap;align-items:center;" },
        servesInput,
        h("span", { class: "prep" }, "serves, or"),
        yieldTextInput
      ),
      h("span", { class: "field-hint" }, "Use serves so Panfare can scale the recipe.")
    ),

    h(
      "div",
      { class: "field" },
      h("label", {}, "Time"),
      h("div", { style: "display:flex;gap:12px;flex-wrap:wrap;align-items:center;" },
        prepInput, h("span", { class: "prep" }, "min prep"),
        cookInput, h("span", { class: "prep" }, "min cook")
      )
    ),

    h("div", { class: "field" }, h("label", { for: "pf-f-tags" }, "Tags"), tagsInput),

    h("div", { class: "field" }, h("label", { for: "pf-f-notes" }, "Notes"), notesInput),

    h(
      "fieldset",
      { style: "border:0;padding:0;margin:0 0 24px;" },
      h("legend", { class: "section-heading", style: "width:100%;" }, "Source"),
      h("div", { class: "field" }, h("label", { for: "pf-f-srcurl" }, "Source URL"), srcUrlInput),
      h("div", { class: "field" }, h("label", { for: "pf-f-srctitle" }, "Source title"), srcTitleInput),
      h("div", { class: "field" }, h("label", { for: "pf-f-srcauthor" }, "Source author"), srcAuthorInput),
      sourceHint
    ),

    h(
      "fieldset",
      { style: "border:0;padding:0;margin:0 0 24px;" },
      h("legend", { class: "section-heading", style: "width:100%;" }, "Photo"),
      photoFile,
      photoRemove,
      photoPreview,
      photoWarn,
      photoError
    ),

    h(
      "fieldset",
      { style: "border:0;padding:0;margin:0 0 24px;" },
      h("legend", { class: "section-heading", style: "width:100%;" }, "Ingredients"),
      h(
        "div",
        { style: "display:flex;gap:12px;align-items:flex-start;margin-bottom:16px;" },
        h("div", { style: "flex:1;" }, bulkInput),
        h("button", { class: "btn", type: "button", onclick: parseBulk }, "Parse lines")
      ),
      ingRowsRegion,
      h(
        "div",
        { style: "display:flex;gap:12px;margin-top:16px;" },
        h("div", { style: "flex:1;" }, addLineInput),
        h("button", { class: "btn", type: "button", onclick: addSingleLine }, "Add line")
      ),
      errIng
    ),

    h(
      "fieldset",
      { style: "border:0;padding:0;margin:0 0 32px;" },
      h("legend", { class: "section-heading", style: "width:100%;" }, "Method"),
      stepsRegion,
      h(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: () => {
            model.steps.push("");
            markDirty();
            rebuildSteps(model.steps.length - 1);
          },
        },
        "Add step"
      ),
      errSteps
    ),

    h(
      "div",
      { style: "display:flex;gap:12px;" },
      h("button", { class: "btn btn-primary", type: "submit" }, "Save recipe"),
      h("button", { class: "btn", type: "button", onclick: cancel }, "Cancel")
    )
  );

  container.append(form);

  rebuildIngRows();
  rebuildSteps();
  if (!model.steps.length) {
    model.steps.push("");
    rebuildSteps();
  }

  form.addEventListener("input", markDirty, true);

  return function cleanup() {
    disposed = true;
  };
}
