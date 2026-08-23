// shortcutsOverlay.mjs — "?" help dialog. Modal <dialog> with focus trap,
// Esc to close, focus returned to the opener. Self-contained: removes itself.

import { h } from "../dom.mjs";

const GROUPS = [
  {
    heading: "Anywhere",
    rows: [
      ["g", "Go to the library"],
      ["l", "Go to the shopping list"],
      ["p", "Go to the planner"],
      ["s", "Go to settings"],
      ["/", "Search the library"],
      ["?", "Show these shortcuts"],
    ],
  },
  {
    heading: "On a recipe",
    rows: [
      ["c", "Cook this recipe"],
      ["e", "Edit this recipe"],
    ],
  },
  {
    heading: "Cook mode",
    rows: [
      ["\u2190 / \u2192", "Previous / next step"],
      ["Esc", "Leave cook mode"],
    ],
  },
  {
    heading: "Dialogs",
    rows: [["Esc", "Close"]],
  },
];

function buildContent(dlg) {
  dlg.append(
    h("h2", { id: "pf-shortcuts-title" }, "Keyboard shortcuts"),
    h(
      "p",
      { class: "field-hint" },
      "Shortcuts never fire while you are typing in a field."
    )
  );
  for (const group of GROUPS) {
    const table = h("table");
    table.append(
      h("caption", { class: "section-heading", style: "text-align:left;" }, group.heading)
    );
    const tbody = h("tbody");
    for (const [keys, action] of group.rows) {
      tbody.append(
        h(
          "tr",
          {},
          h("th", { scope: "row", style: "text-align:left;padding:4px 16px 4px 0;" }, h("kbd", {}, keys)),
          h("td", { style: "padding:4px 0;" }, action)
        )
      );
    }
    table.append(tbody);
    dlg.append(table);
  }
  dlg.append(
    h(
      "p",
      { class: "field-hint", style: "margin-top:16px;" },
      "Press Esc to close."
    )
  );
}

export function showShortcuts() {
  const opener =
    document.activeElement && document.activeElement.tagName !== "BODY"
      ? document.activeElement
      : null;

  const dlg = h("dialog", {
    class: "shortcuts-dialog",
    "aria-labelledby": "pf-shortcuts-title",
    style:
      "border:1px solid var(--pf-line, #e4dcce);border-radius:8px;" +
      "background:var(--pf-surface, #ffffff);color:var(--pf-ink, #26221c);" +
      "padding:24px;max-width:32rem;width:calc(100vw - 48px);",
  });

  const closeBtn = h(
    "button",
    {
      class: "btn",
      type: "button",
      style: "position:absolute;top:12px;right:12px;",
      onclick: () => dlg.close(),
    },
    "Close"
  );

  dlg.append(closeBtn);
  buildContent(dlg);

  dlg.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusables = dlg.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  });

  dlg.addEventListener("close", () => {
    dlg.remove();
    if (opener && typeof opener.focus === "function") opener.focus();
  });

  document.body.append(dlg);
  dlg.showModal();
  closeBtn.focus();
}
