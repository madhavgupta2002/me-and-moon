## Plan: Moon Proximity Rank App ("moon-and-me")

Build an Expo (React Native) app that reads your GPS, computes the Moon's sub-lunar point, draws the spherical cap (your "circle") centered on it out to your position, sums the population inside it, and ranks you. Stand at the sub-lunar point → rank ≈ 1.

**Data sources (found & verified)**
- **Moon position** — `astronomy-engine` (MIT, pure JS, runs in React Native, ±1 arcmin). Compute Moon RA/Dec + Greenwich sidereal time → sub-lunar point: `lat = Dec`, `lon = normalize((RA − GAST)×15)`. Moon distance from its geocentric vector.
- **Population** — SimpleMaps *World Cities Basic*: free, **CC BY 4.0**, ~50k places with lat/lng + population (sums ~4.6B people), single CSV. Bundle as a trimmed JSON asset. (Pro/Comprehensive tiers exist but aren't needed for v1.)

**Core math**
- Haversine angular distance $\theta$ between you and the sub-lunar point.
- Distance to Moon: $d = \sqrt{R^2 + D^2 - 2RD\cos\theta}$ (R = Earth radius, D = Moon distance).
- Rank = (population of all cities with angular distance < $\theta$) + 1; percentile = that sum / total.

**Steps**
1. **Scaffold** — `create-expo-app`, add `expo-location`, `astronomy-engine`, `react-native-maps`; set permission strings in app.json.
2. **Data pipeline** — download SimpleMaps Basic CSV; `scripts/build-cities.js` filters rows with population → `assets/cities.json` + total. *(depends on 1)*
3. **Logic** — `src/moon.js` (sub-lunar point + Moon distance), `src/geo.js` (haversine + law-of-cosines), `src/rank.js` (sum population inside the cap). *(parallel after 1)*
4. **UI** — `App.js`: request permission, `watchPositionAsync`, refresh every ~10s; results card (your coords, sub-lunar coords, km to Moon, "#X of ~4.6B", percentile); MapView with you + sub-lunar markers + Circle overlay. *(depends on 2, 3)*
5. **Verify** — `npx expo start`; emulator simulated location; sanity check: sub-lunar coords → rank ~1, antipode → rank ~total.

**Relevant files (to be created)**
- `app.json` — permissions, Google Maps key (Android map)
- `scripts/build-cities.js` → `assets/cities.json`
- `src/moon.js`, `src/geo.js`, `src/rank.js` — logic
- `App.js` — UI + wiring

**Decisions / scope**
- Included: foreground GPS, sub-lunar point, rank, map+circle, single screen.
- Excluded for v1: background tracking, gridded raster population, topocentric parallax/elevation, backend leaderboard.

**Further considerations**
1. **Population fidelity** — SimpleMaps Basic (50k cities, free, CC BY) vs gridded GHS-POP/WorldPop (accurate everywhere but heavy raster). Recommend Basic for v1.
2. **Map** — include `react-native-maps` (needs a Google Maps API key on Android) now, or ship text-only results first and add the map next? Recommend text-first.
3. **Rank denominator** — the dataset covers ~4.6B people, not the full ~8.1B world population. Label honestly as "of ~4.6B covered" vs scaling up? Recommend honest label.
