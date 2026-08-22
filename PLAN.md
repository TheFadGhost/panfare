# PLAN.md — feature decisions

Every feature below was judged against three tests:
**T1** serves the core purpose (cooking from / planning around recipes) ·
**T2** can be finished to the full quality bar in a buildless JS app with localStorage ·
**T3** stays inside the product (no nutrition database, no delivery integration, no social network).

## Accepted

| Feature | Tests | Why |
|---|---|---|
| Structured recipe model (title, yield, times, parsed ingredients, steps, notes, tags, source) | T1 T2 T3 | The object everything else scales, merges, prints. |
| Ingredient parser with editable review of uncertain lines | T1 T2 T3 | Entry-time structure is what makes later scaling/merging trustworthy; silent guessing destroys trust. |
| Rational scaling (exact thirds/eighths, human fractions) | T1 T2 T3 | The headline promise; floats would break it. |
| Non-linear scaling flags (leavening, salt, spice, pan size, times) | T1 T2 T3 | Correctness duty: warn, never silently multiply. |
| Unit system metric+imperial, volume+weight, density conversion where known, refusal where not | T1 T2 T3 | Merging demands conversions; refusal is the honest default. |
| Shopping list merge with sections, staples exclusion, check-off, kept-separate reasons | T1 T2 T3 | Core planning output. |
| Meal planner (7-day grid, per-slot servings) feeding the list | T1 T2 T3 | The weekly-planning loop itself. |
| Scaling-aware step text (embedded quantities update; temps never scale) | T1 T2 T3 | Steps lie after scaling unless handled. |
| Search/filter: tag, ingredient, “what can I make with these”, time, yield | T1 T2 T3 | Cheap over stored data, directly serves planning. |
| URL import via schema.org Recipe JSON-LD/microdata + paste-HTML fallback + manual entry | T1 T2 T3 | Real recipes arrive as URLs; fallback handles CORS reality. |
| Export markdown / JSON / printable | T1 T2 T3 | Paper on a fridge door is still the best second screen. |
| Local storage with user-owned backup/restore | T1 T2 T3 | Data ownership is the product stance. |
| Cook mode: one-step-at-a-time, ≥24px type, screen wake-lock | T1 T2 T3 | Wet hands at arm’s length is the real reading condition. |
| Step timers parsed from instruction text | T1 T2 T3 | Zero-cost win from structured steps; cooks always need timers. |
| Locale-sensible default units (render-time preference, never re-stored) | T1 T2 T3 | Display concern only; keeps stored data canonical. |
| Helpful import-failure states distinguishing CORS vs no-recipe-found vs partial | T1 T2 T3 | Failure is common; unexplained failure feels broken. |
| Keyboard shortcuts with `?` overlay | T1 T2 T3 | Small surface, big daily-use payoff. |
| Ingredient substitution notes (“or margarine”) | T1 T2 T3 | One field; carried into list items. |
| Per-recipe notes/ratings + cook history log | T1 T2 T3 | Closes the cook→plan feedback loop (“last cooked 3 weeks ago”). |
| Photo attachment, canvas-resized ≤512px JPEG before storage | T1 T2 T3* | Fits quota budget with compression; originals never stored. |
| Kitchen accessibility (targets ≥48px, nothing hover-only, AA contrast all themes) | T1 T2 T3 | The usage context makes this core, not extra. |
| Honest display markers when rendering must approximate (metric rounding, ugly fractions) | T1 T2 T3 | Keeps the exact-arithmetic promise visible instead of silently drifting. |
| Minimal offline PWA (hand-written cache-first service worker) | T1 T2 T3 | Kitchens have bad Wi-Fi; buildless-compatible. |

## Rejected

| Feature | Fails | Why |
|---|---|---|
| Nutrition analysis | T3 (+T2) | Requires a food-composition database — a second product. |
| Grocery delivery integration | T3 | External commerce dependency; different product. |
| Cloud sync / accounts | T2 T3 | Backend + SaaS gravity; local-first with file backup covers the need. |
| Barcode scanning for pantry tracking | T2 T3 | Camera pipeline + product database = second product. |
| Cost estimation per list | T3 | Needs live/local price data; spreadsheet territory. |
| Multi-store aisle profiles | T3 | Turns Panfare into a shopping-list app. |
| Scale-by-ingredient anchor (“make it 500 g flour”) | T2 | Interaction complexity exceeds the quality bar we can finish. |
| Per-step video/photo guides | T2 | Storage-heavy for localStorage; media production burden. |
| Social sharing / public profile pages | T3 | Network product, moderation burden, zero cooking value locally. |

## Build order

Quantity contract (fraction/units/format) → parser → scaling → merge → planner/search/store →
import/export → tokens/styles → UI shell + views → cook mode cluster → PWA/print polish.
Regression gate after each block: full fixture set scaled across factors and merged.
