# DESIGN.md — Panfare visual and interaction design

This document is the design contract. Feature code is built to it; audits check against it.

## Point of view

Panfare is a well-made cookbook that happens to run in a browser: generous margins, confident
serif display type over a warm paper ground, hairline rules instead of drop shadows, and one
warm accent colour used the way a good cookbook uses a second ink — sparingly, for things you
act on. It is not a beige template with a serif heading: the craft lives in real typographic
decisions — quantities aligned in their own column with tabular numerals, true vulgar fractions,
a strict spacing rhythm, small-caps section labels, and print output that survives a fridge door.
The register is calm and domestic. Nothing shouts. Warnings read like a pencil note in the
margin, not an alarm.

## Typography

Fonts: **Fraunces** (Google Fonts, `opsz` axis) for display headings and step numerals, falling
back to Georgia/serif offline. **System sans** (`system-ui` stack) for body/UI — chosen because
it renders crisply at kitchen distances and keeps the app feeling like a tool where it must.

| Role | Font | Size (light/dark themes) | Notes |
|---|---|---|---|
| Recipe title | Fraunces 600 | clamp(28px, 4vw, 40px) | tight leading 1.15 |
| Section label | Sans 600 | 13px, letter-spacing .08em, uppercase | “Ingredients”, “Method” |
| Ingredient item | Sans 500 | 17px | |
| Quantity | Sans 600 | 17px | `font-variant-numeric: tabular-nums` |
| Preparation text | Sans 400 italic | 14.5px | muted ink; AA-verified in every theme |
| Step text | Sans 400 | 18px / 1.65 | max-width 68ch |
| Cook-mode step | Fraunces 500 | 30px / 1.45 | minimum stated body size below |

Spacing scale (single rhythm, px): 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64. Components snap to it.

### Recipe page anatomy

**Ingredient list** — a `<ul>` where every line is a three-column grid:

```
[ qty ][ unit ][ item — preparation ]
```

- `qty`: right-aligned, fixed 5ch track, tabular numerals. Ranges render “2–3”.
- `unit`: lowercase, never pluralised oddly (“tbsp”, “cups” pluralised only when value > 1).
- `item` carries the food name; `preparation` follows after an em-dash in muted italics
  (“plain flour — sifted”). Optional substitution notes sit on a second indented line,
  prefixed “or ”, still muted.
- Alignment must hold with pathological inputs (long units like “fluid ounces”, wide fractions).
  Grid tracks are fixed; text wraps inside the item column only.

**Fractions** — never bare decimals. Imperial/customary units and fractional results always
render as fractions (below). Metric base units (g, ml, kg, l) may render as rounded integers
when that matches kitchen convention (“170 g”, “0.5 l” renders “500 ml”); when rounding error
exceeds ~2% of the true value the quantity carries an explicit “≈” prefix and the exact value
is available in its tooltip/aria-label. Rendering order for fractional values:
1. Unicode vulgar glyph when the value is < 1 and denominator ∈ {2,3,4,5,6,8} (“¾”);
2. Mixed number: integer + glyph (“1½”);
3. Otherwise a styled stacked fraction: `<sup>3</sup>⁄<sub>16</sub>` using U+2044, sized ~0.72em,
   baseline-aligned so the line height does not jump.
Every rendered quantity carries `aria-label` with the spoken form (“three quarters”, “one and
a half cups”), so screen readers hear words, not symbol soup.

**Steps** — a `<ol>`; the counter is a Fraunces numeral in its own left column (hanging indent),
step text in the main measure. Embedded quantities that react to scaling are wrapped in
`<data class="scaled-qty">` with a very quiet background tint and dotted underline — visible on
inspection, invisible while reading. Temperatures never scale; durations scale never silently
(they raise the same margin-note treatment as non-linear ingredients).

## Cook mode

Entered from a recipe (“Cook” button, shortcut `c`). One step fills the viewport.

- Minimum body size: **24px** (steps 30px). Stated minimum reading distance: 1.5 m.
- Touch targets: minimum **56×56px** in cook mode, 48×48 elsewhere.
- Screen wake: requests `navigator.wakeLock` on entry, releases on exit; failure is silent.
- Navigation: huge prev/next zones, progress “Step 3 of 7”, keyboard ←/→/Esc.
- Timers parsed from step text render as tappable chips (“Start 35:00”) with a running ring;
  completion is a gentle chime-free banner (no autoplay audio blast).
- Finish action records a cook-history entry (date + scale factor + optional rating).

Cook mode forces the high-contrast token set regardless of active theme.

## Shopping list

Grouped by supermarket aisle in walking order: Produce → Bakery → Dairy & chilled → Meat & fish
→ Frozen → Pantry → Spices & baking → Other. Each group is a `<section>` with a small-caps
heading and an item count.

Item row: large custom checkbox (48px hit area, square, thick check stroke) · quantity in the
same fraction typography as recipes · unit · item name; preparation/merge notes underneath in
muted text. A row kept separate deliberately shows a quiet reason chip: “kept separate —
different preparation”, “no reliable cup↔gram conversion”.

Check-off state: strike-through + reduced ink, row stays in place (no reflow jumping while
shopping). Header shows “7 of 12 ticked”. A “reset ticks” affordance sits in overflow.

Pantry staples toggle in the toolbar; excluded staples collapse into a countable footer line
(“4 pantry staples hidden”) rather than vanishing silently.

## Scaling control

Segmented quick factors `½ ⅔ ¾ 1 1½ 2 3` plus a custom field accepting typed fractions
(`"1 1/2"`, `"3/4"`), showing resolved yield (“serves 12”). Non-linear ingredients do **not**
raise a red alert: they render normally, and a calm amber margin-note panel appears beneath the
control listing them once each — “baking powder — leavening doesn’t scale linearly; adjust to
taste”. Same treatment for oven times inside steps. Amber, bordered-left, never modal, never red,
never blocking.

## Colour

Tokens by role (defined in `src/styles/tokens.mjs`, injected as CSS custom properties; the same
module feeds automated WCAG-ratio tests):

| Token | Light (default) | Dark | High-contrast cook |
|---|---|---|---|
| paper (page) | #FAF6EF | #1B1815 | #12100D |
| surface (cards) | #FFFFFF | #25211D | #1A1713 |
| ink (primary text) | #26221C | #F1EBE1 | #FFF8EC |
| ink-muted (prep, notes) | #5D564A | #B4AA99 | #D8CFBE |
| accent (actions, links) | #A64B22 | #E8946A | #FFB65C |
| on-accent (text on accent) | #FFFFFF | #1B1815 | #12100D |
| line (hairlines) | #E4DCCE | #3B352E | #4A4238 |
| warn-bg / warn-text | #F6EBD4 / #6B4A12 | #3A2F1B / #EFC983 | #40331A / #FFD98A |
| ok | #3E6B4F | #7FB894 | #8FE0AC |
| danger | #A03123 | #E77A67 | #FF9E8A |
| focusRing (= accent per theme) | #A64B22 | #E8946A | #FFB65C |

Focus-ring contrast vs paper: light 5.34:1, dark 7.47:1, cook 10.94:1 — all pass the 3:1
non-text requirement.

Rules: AA (4.5:1) for all text roles including muted preparation text in **every** theme;
accent-on-paper and on-accent pairs verified too. A test computes ratios from the same token
source the UI loads — themes that fail cannot ship. No gradients, no glass, no coloured shadow.

Themes are pure token overrides; components reference roles only. Settings offers Light, Dark,
High-contrast cook, plus “match system”.

## States

- **Empty**: typographic centred block — serif line (“Nothing here yet.”), one sentence, one
  primary action. No illustrations, no emoji.
- **Loading**: skeleton blocks matching final layout; animation is an opacity pulse and stops
  entirely under `prefers-reduced-motion`.
- **Error**: inline banner above content, danger-bordered, one plain-language sentence +
  concrete next step + Retry. Errors never wipe entered data.
- **Import failed**: distinct panel explaining what was looked for (schema.org Recipe data),
  why a fetch can fail (site CORS rules — not a Panfare bug), and the fallback: copy the page’s
  HTML and paste it into the importer directly.
- **Form validation**: message beside the field, `aria-describedby`, focus moved to first error.

## Motion, focus, input

- Motion: 120–180ms ease-out transitions on state changes only. `prefers-reduced-motion`
  disables all movement (including skeleton pulse and timer ring spin → static label swap).
- Focus: 2px accent outline, 2px offset, always visible (`:focus-visible`). Every action is
  reachable by keyboard; shortcuts are listed behind `?`. Nothing important lives behind hover.
- Semantics: ingredients are `<ul>` lists, steps `<ol>`; quantities speak via `aria-label`;
  toggles are real checkboxes/switches; dialogs trap focus and close on Esc.

## Print

`@media print`: hide nav/toolbars/timers; black on white; ingredient grid and step numbering
preserved; checkbox glyphs become printed squares; page breaks never split an ingredient row or
a step from its number; title, yield-at-current-scale and source attribution appear on page one.
