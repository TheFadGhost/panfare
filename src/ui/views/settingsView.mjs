// settingsView.mjs â€” themes, units, staples, data safety, recipe import.

import { h, clear } from "../dom.mjs";
import {
  getState, subscribe, updateSettings,
  exportBackup, importBackup, seedSamples, upsertRecipe,
} from "../state.mjs";
import { DEFAULT_STAPLES } from "../../core/shoppingList.mjs";
import { fetchAndExtract, extractRecipesFromHtml } from "../../core/importer.mjs";
import { makeId } from "../../core/id.mjs";
import { navigate } from "../router.mjs";

function banner(kind, msg) {
  return h("div", { class: kind === "error" ? "banner-error" : "banner-ok", role: "status" }, msg);
}

function slugId(prefix, value) {
  return prefix + "-" + String(value).replace(/[^a-z]/gi, "");
}

export function settingsView(container) {
  let unsub = null;

  function render() {
    clear(container);
    const state = getState();
    const settings = state.settings || {};
    const staples = Array.isArray(settings.staples) && settings.staples.length
      ? settings.staples
      : [...DEFAULT_STAPLES];

    // ---- appearance ---------------------------------------------------------
    const themeFieldset = h("fieldset", {},
      h("legend", {}, "Theme"),
      ["light", "dark", "contrast", "system"].map((t) => {
        const id = slugId("theme", t);
        const label = t === "contrast"
          ? "High-contrast (always used in cook mode)"
          : t.charAt(0).toUpperCase() + t.slice(1);
        const input = h("input", {
          type: "radio",
          name: "pf-theme",
          id,
          value: t,
          ...(settings.theme === t ? { checked: true } : {}),
          onchange: () => updateSettings({ theme: t }),
        });
        return h("div", {}, h("label", { for: id }, input, " ", label));
      }));

    // ---- units ---------------------------------------------------------------
    const unitsFieldset = h("fieldset", {},
      h("legend", {}, "Units"),
      h("p", { class: "muted" },
        "Conversions inside a dimension are exact. Volume and weight are only ever bridged when the ingredientâ€™s density is known; otherwise amounts are kept separate."),
      [["auto", "Auto (keep each recipeâ€™s own system)"], ["metric", "Prefer metric"], ["imperial", "Prefer imperial"]].map(([val, label]) => {
        const id = slugId("units", val);
        const input = h("input", {
          type: "radio",
          name: "pf-units",
          id,
          value: val,
          ...((settings.unitsSystem ?? "auto") === val ? { checked: true } : {}),
          onchange: () => updateSettings({ unitsSystem: val === "auto" ? null : val }),
        });
        return h("div", {}, h("label", { for: id }, input, " ", label));
      }));

    // ---- staples ---------------------------------------------------------------
    const stapleListEl = h("ul", { class: "staple-list" });
    function drawStaples() {
      clear(stapleListEl);
      for (const s of staples) {
        stapleListEl.append(h("li", {},
          s,
          " ",
          h("button", {
            class: "btn btn-small",
            type: "button",
            "aria-label": "Remove " + s + " from staples",
            onclick: () => {
              const idx = staples.indexOf(s);
              if (idx >= 0) staples.splice(idx, 1);
              updateSettings({ staples: [...staples] });
              drawStaples();
            },
          }, "Remove")));
      }
    }
    drawStaples();
    const stapleAddInput = h("input", { type: "text", "aria-label": "Add a staple", placeholder: "e.g. rapeseed oil" });
    const staplesFieldset = h("fieldset", {},
      h("legend", {}, "Pantry staples"),
      h("p", { class: "muted" }, "Hidden from shopping lists when the toggle is on."),
      stapleListEl,
      h("form", {
        class: "inline-form",
        onsubmit: (e) => {
          e.preventDefault();
          const v = stapleAddInput.value.trim();
          if (!v) return;
          if (!staples.some((s) => s.toLowerCase() === v.toLowerCase())) staples.push(v);
          stapleAddInput.value = "";
          updateSettings({ staples: [...staples] });
          drawStaples();
        },
      },
        stapleAddInput,
        h("button", { class: "btn btn-small", type: "submit" }, "Add")));

    // ---- data ------------------------------------------------------------------
    const statusArea = h("div", {});
    const estimateP = h("p", { class: "muted" }, "Estimating storageâ€¦");
    async function drawEstimate() {
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          const kb = Math.round((est.usage || 0) / 1024);
          estimateP.textContent =
            "Storage used: about " + kb.toLocaleString("en-GB") + " KB of local data.";
        } else {
          estimateP.textContent = "Storage use is managed by your browser.";
        }
      } catch {
        estimateP.textContent = "";
      }
    }
    drawEstimate();

    const exportBtn = h("button", {
      class: "btn",
      type: "button",
      onclick: () => {
        const text = exportBackup();
        const blob = new Blob([text], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "panfare-backup-" + new Date().toISOString().slice(0, 10) + ".json";
        a.click();
        URL.revokeObjectURL(a.href);
        clear(statusArea);
        statusArea.append(banner("ok", "Backup downloaded."));
      },
    }, "Export backup");

    const modeRadios = ["replace", "merge"].map((m) => {
      const id = slugId("restore", m);
      const input = h("input", {
        type: "radio", name: "pf-restore-mode", id, value: m,
        ...(m === "merge" ? { checked: true } : {}),
      });
      return h("span", {}, h("label", { for: id }, input, " ", m === "merge" ? "Merge with current" : "Replace everything"), " ");
    });
    const fileInput = h("input", {
      type: "file",
      accept: ".json,application/json",
      "aria-label": "Choose backup file",
    });
    const restoreBtn = h("button", {
      class: "btn",
      type: "button",
      onclick: () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) {
          clear(statusArea);
          statusArea.append(banner("error", "Choose a backup file first."));
          return;
        }
        const mode = (document.querySelector('input[name="pf-restore-mode"]:checked') || {}).value || "merge";
        const reader = new FileReader();
        reader.onerror = () => {
          clear(statusArea);
          statusArea.append(banner("error", "That file could not be read — try selecting it again."));
        };
        reader.onload = () => {
          try {
            importBackup(String(reader.result), mode);
            clear(statusArea);
            statusArea.append(banner("ok", "Backup restored (" + mode + ")."));
          } catch (err) {
            clear(statusArea);
            statusArea.append(banner("error", "That doesnâ€™t look like a Panfare backup â€” nothing was changed. (" + err.message + ")"));
          }
        };
        reader.readAsText(file);
      },
    }, "Restore");

    // ---- import -----------------------------------------------------------------
    const urlInput = h("input", { type: "url", placeholder: "https://example.com/some-recipe", "aria-label": "Recipe page address" });
    const pasteArea = h("textarea", {
      rows: "6",
      "aria-label": "Paste page HTML",
      placeholder: "Paste the pageâ€™s full HTML here (Ctrl+A on the page, copy, paste).",
    });
    const importStatus = h("div", { "aria-live": "polite" });
    const previewArea = h("div", {});

    function importFailedPanel(reason, details) {
      const corsNote = reason === "fetch-blocked"
        ? "The site refused the request. Most sites block browser cross-origin reads (CORS). This is not a Panfare fault."
        : reason === "http-error"
          ? "The site answered with an error (" + details + ")."
          : "No schema.org Recipe data was found on that page.";
      return h("div", { class: "banner-error import-failed" },
        h("strong", {}, "Import failed."),
        h("p", {}, corsNote),
        h("p", {}, "Fallback: open the page yourself, select all, copy, and paste its HTML below. Panfare reads the same recipe data from the pasted page."),
        pasteArea,
        h("div", { class: "btn-row" },
          h("button", {
            class: "btn",
            type: "button",
            onclick: () => {
              const html = pasteArea.value;
              if (!html.trim()) return;
              runExtract(html, null);
            },
          }, "Read pasted HTML"),
          h("button", { class: "btn", type: "button", onclick: render }, "Cancel")));
    }

    function runExtract(htmlText, sourceUrl) {
      clear(importStatus);
      clear(previewArea);
      const result = extractRecipesFromHtml(htmlText, sourceUrl);
      if (!result.ok) {
        importStatus.append(importFailedPanel(result.reason, result.details));
        return;
      }
      for (const partial of result.recipes.slice(0, 5)) {
        previewArea.append(previewCard(partial));
      }
      if (result.recipes.length > 5) {
        importStatus.append(banner("ok", result.recipes.length + " recipes found; showing the first five."));
      }
    }

    function previewCard(partial) {
      const card = h("article", { class: "card" },
        h("h3", {}, partial.title || "Untitled"),
        h("p", { class: "muted" },
          (partial.yield && (partial.yield.text || (partial.yield.serves ? "serves " + partial.yield.serves : "")) || "") +
          " Â· " + partial.ingredients.length + " ingredients Â· " + partial.steps.length + " steps"),
        partial.source && (partial.source.title || partial.source.author)
          ? h("p", { class: "muted" }, "Source: " + [partial.source.author, partial.source.title].filter(Boolean).join(", "))
          : null,
        h("details", {},
          h("summary", {}, "Preview ingredients"),
          h("ul", {}, partial.ingredients.map((i) => h("li", {}, i.raw || i.item)))),
        h("div", { class: "btn-row" },
          h("button", {
            class: "btn btn-primary",
            type: "button",
            onclick: () => {
              const now = new Date().toISOString();
              const full = {
                ...partial,
                id: makeId("r"),
                createdAt: now,
                updatedAt: now,
                rating: null,
                history: [],
                photo: null,
              };
              upsertRecipe(full);
              navigate("#/recipe/" + full.id);
            },
          }, "Add to library")));
      return card;
    }

    const fetchBtn = h("button", {
      class: "btn btn-primary",
      type: "button",
      onclick: async () => {
        const url = urlInput.value.trim();
        if (!url) return;
        clear(importStatus);
        clear(previewArea);
        importStatus.append(h("p", { class: "muted" }, "Fetchingâ€¦"));
        const res = await fetchAndExtract(url);
        clear(importStatus);
        if (!res.ok) {
          importStatus.append(importFailedPanel(res.reason, res.details));
        } else {
          for (const p of res.recipes.slice(0, 5)) previewArea.append(previewCard(p));
        }
      },
    }, "Fetch and read");

    const importFieldset = h("fieldset", { class: "no-print" },
      h("legend", {}, "Import a recipe from the web"),
      h("p", { class: "muted" },
        "Panfare reads schema.org Recipe data (JSON-LD or microdata) and keeps the author and site attribution."),
      h("form", {
        class: "inline-form",
        onsubmit: (e) => { e.preventDefault(); fetchBtn.click(); },
      }, urlInput, fetchBtn),
      importStatus,
      previewArea);

    // ---- assemble ------------------------------------------------------------
    container.append(
      h("header", {}, h("h1", {}, "Settings")),
      themeFieldset,
      unitsFieldset,
      staplesFieldset,
      importFieldset,
      h("fieldset", {},
        h("legend", {}, "Your data"),
        h("p", { class: "muted" },
          "Everything lives in this browserâ€™s local storage â€” no account, no server.",
          " Backups are plain JSON files you own."),
        estimateP,
        h("div", { class: "btn-row" }, exportBtn, fileInput, restoreBtn),
        h("div", {}, modeRadios),
        statusArea,
        h("hr"),
        h("button", {
          class: "btn",
          type: "button",
          onclick: () => {
            const n = seedSamples();
            clear(statusArea);
            statusArea.append(banner("ok", n ? "Added " + n + " sample recipes." : "Samples already in your library."));
          },
        }, "Load sample recipes")),
    );
  }

  render();
  unsub = subscribe(() => render());

  return function cleanup() {
    unsub();
  };
}
