# 🌙 moon & me

How close are you to the Moon right now — and how do you rank against the rest of the world?

`moon & me` reads your GPS location, figures out the exact point on Earth where the Moon is directly overhead (the **sub-lunar point**), measures your straight-line distance to the Moon, and ranks you against the world's population based on how many people are physically closer to the Moon than you are. Stand directly under the Moon and your rank approaches **#1**.

## How it works

Your straight-line distance to the Moon depends almost entirely on your **angular distance** from the sub-lunar point. Anyone whose angular distance to that point is smaller than yours is closer to the Moon than you. So:

1. **Sub-lunar point** — using [`astronomy-engine`](https://github.com/cosinekitty/astronomy), compute the Moon's geocentric position, convert to right ascension / declination, and combine with Greenwich sidereal time to get the latitude/longitude where the Moon is at the zenith.
2. **Your distance to the Moon** — law of cosines on the Earth–Moon triangle:

   d = sqrt(R² + D² − 2·R·D·cos θ)

   where R is Earth's radius, D is the Earth-center-to-Moon distance, and θ is your angular distance from the sub-lunar point.
3. **Your rank** — sum the population of every city whose angular distance to the sub-lunar point is smaller than yours. Rank = that sum + 1.

## Project structure

| Path | Purpose |
| --- | --- |
| `App.js` | UI and wiring: GPS permission, live updates, rank/distance cards, map |
| `src/moon.js` | Sub-lunar point and Moon distance (`astronomy-engine`) |
| `src/geo.js` | Haversine angular distance + law-of-cosines distance to the Moon |
| `src/rank.js` | Population-based proximity ranking |
| `src/MapPanel.js` | Keyless Leaflet + OpenStreetMap map (rendered in a WebView) |
| `assets/cities.json` | Bundled population dataset (seed data included) |
| `scripts/build-cities.js` | Converts a SimpleMaps World Cities CSV into `cities.json` |
| `scripts/sanity.mjs` | Numerical self-test of the Moon + ranking math |

## Getting started

### Prerequisites

- Node.js 20.19+, 22.13+, or 24.3+ (Expo SDK 56 requirement)
- The [Expo Go](https://expo.dev/go) app on your phone (for device testing)

### Install

```powershell
npm install
```

### Run

```powershell
npx expo start
```

Then:

- **Phone** — scan the QR code with Expo Go (Android) or the Camera app (iOS). Use `npx expo start --tunnel` if your network blocks the LAN connection.
- **Android emulator** — press `a`. Set a fake location via the emulator's **Extended controls → Location**.
- **Web** — press `w`. GPS and ranking work; the map shows a placeholder (the WebView map is mobile-only).

## Population data

The app ships with a small **seed dataset** of major world metros so it runs out of the box. For full coverage, replace it with the free **SimpleMaps World Cities (Basic)** dataset (CC BY 4.0, ~50k places):

1. Download `worldcities.csv` from <https://simplemaps.com/data/world-cities> (Basic / free tier).
2. Generate the bundled asset:

   ```powershell
   node scripts/build-cities.js path\to\worldcities.csv
   ```

This writes cities.json with `{ lat, lng, population }` for every place that has population data.

> The ranking denominator is the **covered population** in the dataset (not the full ~8.1B world population), and is labeled as such in the UI.

## Validate the math

```powershell
node scripts/sanity.mjs
```

Checks that the sub-lunar point is a valid coordinate with a plausible Moon distance, that standing at the sub-lunar point yields rank **#1**, and that the antipode yields the full population.

## Tech stack

- [Expo](https://expo.dev/) (React Native)
- [`expo-location`](https://docs.expo.dev/versions/latest/sdk/location/) — GPS
- [`astronomy-engine`](https://github.com/cosinekitty/astronomy) — Moon position (MIT)
- [`react-native-webview`](https://github.com/react-native-webview/react-native-webview) + [Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/) — keyless map

## Scope & limitations

- Foreground location only (no background tracking).
- Ranking uses city-point populations, not a continuous population raster.
- Ignores observer elevation and topocentric parallax (sub-arcminute effect at this scale).
- The public OpenStreetMap tile server is fine for development; use a tile provider with a usage allowance for a released app.

## License

See LICENSE. Population data © SimpleMaps (CC BY 4.0). Map tiles © OpenStreetMap contributors.
