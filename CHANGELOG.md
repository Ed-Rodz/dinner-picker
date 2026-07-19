# Changelog

Plain-English record of what's shipped.

## 2026-07-18 — Two recipe sources merged
TheMealDB's free API only has real recipe data for ~28 of its ~190 cuisine/area values, leaving American, French, Indian, Korean, Latin American, and Caribbean thin or empty. Added Spoonacular as a second source (free-tier API key) — cuisine-only searches now pull from both and merge the results, restoring those cuisines with real variety. Category filters still use TheMealDB only, since the two APIs don't share a clean category taxonomy.

## 2026-07-18 — Split Caribbean out of Latin American
Jamaican recipes were lumped into "Latin American," which didn't fit. Split into its own Caribbean category (Jamaican-only for now — no other Caribbean-tagged area had recipes in TheMealDB's free tier before Spoonacular was added).

## 2026-07-18 — Curated cuisine dropdown
The raw cuisine dropdown listed all ~190 of TheMealDB's country-level "area" values, most with zero actual recipes. Replaced it with ~11 broader groups (Mexican, Latin American, Mediterranean, Italian, Chinese, Japanese, Thai, Southeast Asian, British & Irish, Eastern European, Middle Eastern & North African), each combining only the underlying areas that actually have data.

## 2026-07-18 — Fixed "Try another" repeating the same recipe
The browser was serving a cached response for repeat API calls to the same URL (TheMealDB sends no cache-control headers), so rerolling with no filters kept showing the same meal. Forced `cache: no-store` on all requests.

## 2026-07-18 — Initial version
First working version: live recipe suggestions from TheMealDB, filterable by cuisine and meal type, "surprise me" random pick, and a local history (stored in the browser) that avoids repeating your last few cooked meals. Deployed to GitHub Pages for shared access.
