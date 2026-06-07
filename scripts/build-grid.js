#!/usr/bin/env node
/*
 * build-grid.js  —  STEP 2 of the data pipeline (rural fill).
 *
 * A city list (STEP 1, build-cities.js) only contains urban population — roughly
 * 4-5 billion of the world's ~8.1 billion people. The other ~3 billion live in
 * the countryside and appear in NO city dataset, so ranking against a city list
 * alone tops out well short of the true world population.
 *
 * This script approximates that missing rural population so the ranking covers
 * the full ~8.1B. It does NOT invent people in the ocean: rural people live near
 * existing settlements, so we scatter the rural remainder onto a coarse land
 * grid, weighting each land cell by how much urban population sits nearby. Cells
 * with no nearby city (oceans, deep desert, ice) get nothing.
 *
 *   rural_target            = WORLD_POPULATION - urban_total
 *   weight(cell)            = sum over nearby cities of pop * (1 - dist/R)   [R = REACH_KM]
 *   rural_pop(cell)         = rural_target * weight(cell) / sum(weights)
 *
 * Input:  assets/cities.urban.json   (from build-cities.js, or the 119-metro seed)
 * Output: assets/cities.json         (urban points + rural grid cells; the app loads this)
 *
 * Usage:
 *   node scripts/build-grid.js
 *
 * ---------------------------------------------------------------------------
 * FULL / EXACT DATA (no approximation — covers all ~8.1B incl. rural precisely):
 *   Replace this whole step with a real gridded population raster:
 *     - NASA SEDAC GPWv4  (https://sedac.ciesin.columbia.edu)  ~1 km cells, or
 *     - WorldPop          (https://www.worldpop.org)           ~100 m / 1 km cells.
 *   Download the population-COUNT GeoTIFF, downsample it to a manageable cell
 *   size (e.g. 0.25-1.0 deg), and emit one [lat, lng, pop] entry per non-zero
 *   cell straight into assets/cities.json. That raster already includes rural
 *   population in the correct places, so the heuristic below is no longer needed.
 *   Full-resolution rasters are hundreds of MB to GB — always downsample before
 *   bundling into the app, or serve the grid from a backend / spatial index.
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

// Tunables.
const WORLD_POPULATION = 8.1e9; // ~2025 world population.
const GRID_STEP_DEG = 1.5;      // Cell size. Smaller = finer coverage, larger file.
const REACH_KM = 300;           // How far rural population spreads around a city.
const MIN_CELL_POP = 1000;      // Drop near-empty cells to keep the file small.
const EARTH_RADIUS_KM = 6371.0088;

const toRad = (d) => (d * Math.PI) / 180;

function haversineKm(lat1, lon1, lat2, lon2) {
    const dPhi = toRad(lat2 - lat1);
    const dLam = toRad(lon2 - lon1);
    const a =
        Math.sin(dPhi / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLam / 2) ** 2;
    const aC = Math.min(1, Math.max(0, a));
    return 2 * Math.atan2(Math.sqrt(aC), Math.sqrt(1 - aC)) * EARTH_RADIUS_KM;
}

// Bucket cities into a coarse lat/lon hash so each grid cell only checks nearby
// cities instead of all of them (keeps it fast for the full 50k-city dataset).
const BUCKET_DEG = 5;
function bucketKey(lat, lon) {
    const bl = Math.floor((lat + 90) / BUCKET_DEG);
    const bo = Math.floor((lon + 180) / BUCKET_DEG);
    return `${bl}:${bo}`;
}

function main() {
    const assetsDir = path.join(__dirname, '..', 'assets');
    const urbanPath = path.join(assetsDir, 'cities.urban.json');
    if (!fs.existsSync(urbanPath)) {
        console.error(`Missing ${urbanPath}. Run build-cities.js first (or copy the seed to cities.urban.json).`);
        process.exit(1);
    }

    const urban = JSON.parse(fs.readFileSync(urbanPath, 'utf8'));
    const cities = urban.cities;
    const urbanTotal = urban.totalPopulation;
    const ruralTarget = Math.max(0, WORLD_POPULATION - urbanTotal);

    // Build the spatial index.
    const buckets = new Map();
    for (const c of cities) {
        const k = bucketKey(c[0], c[1]);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(c);
    }
    const reachBuckets = Math.ceil(REACH_KM / 111 / BUCKET_DEG) + 1;

    // First pass: weight every land grid cell.
    const cells = [];
    let weightSum = 0;
    for (let lat = -90 + GRID_STEP_DEG / 2; lat < 90; lat += GRID_STEP_DEG) {
        for (let lon = -180 + GRID_STEP_DEG / 2; lon < 180; lon += GRID_STEP_DEG) {
            const bl = Math.floor((lat + 90) / BUCKET_DEG);
            const bo = Math.floor((lon + 180) / BUCKET_DEG);
            let w = 0;
            for (let dbl = -reachBuckets; dbl <= reachBuckets; dbl++) {
                for (let dbo = -reachBuckets; dbo <= reachBuckets; dbo++) {
                    const arr = buckets.get(`${bl + dbl}:${bo + dbo}`);
                    if (!arr) continue;
                    for (const c of arr) {
                        const d = haversineKm(lat, lon, c[0], c[1]);
                        if (d < REACH_KM) w += c[2] * (1 - d / REACH_KM);
                    }
                }
            }
            if (w > 0) {
                cells.push([lat, lon, w]);
                weightSum += w;
            }
        }
    }

    // Second pass: turn weights into rural population.
    const ruralCells = [];
    let ruralAssigned = 0;
    if (weightSum > 0) {
        for (const cell of cells) {
            const pop = Math.round((ruralTarget * cell[2]) / weightSum);
            if (pop >= MIN_CELL_POP) {
                ruralCells.push([Math.round(cell[0] * 1e4) / 1e4, Math.round(cell[1] * 1e4) / 1e4, pop]);
                ruralAssigned += pop;
            }
        }
    }

    const merged = cities.concat(ruralCells);
    const totalPopulation = urbanTotal + ruralAssigned;
    const payload = {
        totalPopulation,
        count: merged.length,
        generatedAt: new Date().toISOString(),
        source:
            `${urban.source || 'urban points'} + coarse rural fill grid (${GRID_STEP_DEG}\u00b0, REACH ${REACH_KM}km) ` +
            `scaled to WORLD_POPULATION=${WORLD_POPULATION.toLocaleString()}`,
        cities: merged,
    };
    const outPath = path.join(assetsDir, 'cities.json');
    fs.writeFileSync(outPath, JSON.stringify(payload));
    console.log(
        `Urban ${urbanTotal.toLocaleString()} (${cities.length}) + rural ${ruralAssigned.toLocaleString()} (${ruralCells.length} cells) ` +
        `= ${totalPopulation.toLocaleString()} total in ${merged.length} entries -> ${outPath}`
    );
}

main();
