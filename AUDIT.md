# AUDIT.md — pre-v1.0.0 audit ledger

Audits performed by fresh agents that wrote none of the audited code:
code audit, design audit (measured in headless Chrome), stranger-reads-README audit.
Status legend: OPEN → FIXED → VERIFIED (re-run gates).

## Code audit findings

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| C1 | blocker | Recipe create/edit unroutable: form never registered; `#/recipe/new`, `#/recipe/edit:<id>` fall through to recipeView | FIXED (dedicated routes + smoke coverage) |
| C2 | major | Unit-less quantified lines ("3 eggs") dropped from merging and cook-mode aside, mislabeled "no quantity stated" | FIXED |
| C3 | major | Exiting cook mode leaves high-contrast theme stuck when setting is "system" | FIXED |
| C4 | major | `preferredTheme()` ignores prefers-color-scheme:dark; "match system" can never pick Dark | FIXED |
| C5 | major | Quota errors broadcast on window event nobody listens to; silent data-loss risk | FIXED (persistent banner listener) |
| C6 | major | `toPrintableHtml` shopping list crashes on legal `{amount:null}` entries; module otherwise unwired | FIXED (guarded + tested; documented as library API used by future print path) |
| C7 | major | Density lookup fed qualifier-stripped key: "icing sugar"→sugar 85/100 instead of 56/100; ground almonds unreachable | FIXED (raw-tail-first lookup + test) |
| C8 | major | Three drifting copies of number-token parsing (parser/scaling/view); inconsistent maxDen | PARTIAL-FIX (single tokenizer exported from parser, scaling re-points; maxDen unified at 8 with honest ≈) |
| C9 | minor | tryConvert count-mismatch returns sentence, not contract reason `different-count-unit` | FIXED |
| C10 | minor | Router async-mount staleness can clobber cleanup token | FIXED |
| C11 | minor | Wake-lock release listener missing; visibility retry path dead | FIXED |
| C12 | minor | Backup FileReader lacks onerror | FIXED |
| C13 | minor | Dead `t.range` branch in cook timer labels | FIXED |
| C14 | minor | Duplicate applyTheme subscription in app boot | FIXED |
| C15 | minor | Shortcuts overlay documents unimplemented keys (p=print, Space) | FIXED (overlay states real bindings) |
| C16 | minor | Regression gate rule neutered with `&& false`; inverted non-integer numerator check | FIXED |
| C17 | minor | Meaningless identical-arm ternary in parser test assertion | FIXED |
| C18 | minor | Imported/source URLs rendered without scheme allow-list (`javascript:` risk) | FIXED (`safeUrl()` applied at import + render + exports) |
| C19 | minor | Form stores parser-only fields (`uncertain`) diverging from CONTRACT shape | FIXED |
| C20 | minor | Title-less recipes crash planner sort | FIXED |
| C21 | minor | "10½ cups" degrades to uncertain; glued vulgar handled only up to 2 chars | FIXED |
| C22 | nit | Floating cache.put promise in service worker | FIXED |
| C23 | nit | List-view mode-switch remount leaks subscriber/timer per click | FIXED |
| C24 | nit | Redundant second ≈-strip in range html | FIXED |
| C25 | nit | Identity synonym entries in names.mjs | FIXED |
| C26 | minor | Recipe-id generation inconsistent/collision-prone (Date.now vs slug) | FIXED (single id helper, slug-style) |
| C27 | nit | Printable list can emit double ≈ | FIXED |
| C28 | nit | Mojibake em-dash in tools/smoke.mjs comment | FIXED |

## Design audit findings (measured in Chrome)

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| D1 | blocker | 13⁄16 floz renders "1 fl oz" — relative-error guard miscompares (den-inflated RHS) AND view strips formatQuantity's ≈ marker | FIXED (formula corrected; view preserves marker; new unit tests incl. 13/16 and 15/32) |
| D2 | major | "?" overlay import path wrong (`./shortcutsOverlay.mjs` → views/) — SPA fallback masked 404 as HTML | FIXED (path corrected; dev server returns 404 for missing .mjs) |
| D3 | major | = C3 | FIXED |
| D4 | major | List picker forgets selection on every rebuild/remount | FIXED (picker state hoisted to module scope) |
| D5 | minor | Unknown/stale unit id silently renders empty unit cell | FIXED ("unknown unit" chip) |
| D6 | minor | Activating scale factor drops keyboard focus to body | FIXED (refocus activated control) |
| D7 | minor | Segmented control lacks Arrow-key roving tabindex | FIXED |
| D8 | minor | Cook mode never moves focus on entry/step change | FIXED (focuses step region) |

Design audit verified solid (measured): zero bare decimals across 39 factor-scans; pathological
alignment 0px spread; cook step 30px/64px targets/17.99:1 contrast; themes ≥4.5:1 everywhere;
keyboard-only path complete with visible focus; SR semantics correct; print clean; reduced motion
honoured.

## Stranger-reads-README findings

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| S1 | minor | No engines field; README claims Node 18+, but JSON import attributes need newer | FIXED (engines >=20.10; README updated) |
| S2 | nit | settings-dark.png unreferenced | FIXED (removed) |
| — | ok | All other claims verified against reality (ports, conventions, counts, fixtures, deps) | — |

## Verification after fixes

- vitest suite: see final run log below
- regression gate: see below
- smoke: tools/smoke.mjs extended with create/edit coverage
