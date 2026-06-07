#!/usr/bin/env node
/*
 * build-cities.js  —  STEP 1 of the data pipeline (urban points).
 *
 * Converts the SimpleMaps "World Cities" CSV into a compact JSON asset of urban
 * population points. This covers cities/towns only (~4-5 billion people). The
 * remaining ~3 billion rural people are NOT in any city list, so STEP 2
 * (scripts/build-grid.js) scatters them as a coarse land grid to reach the true
 * world total. The app loads the STEP 2 output (assets/cities.json).
 *
 * Data source (free tier, CC BY 4.0):
 *   https://simplemaps.com/data/world-cities  ->  "Basic" download (worldcities.csv)
 *
 * Usage:
 *   node scripts/build-cities.js path/to/worldcities.csv   # writes assets/cities.urban.json
 *   node scripts/build-grid.js                             # writes assets/cities.json
 *
 * Output:
 *   assets/cities.urban.json -> { totalPopulation, count, generatedAt, source, cities: [[lat, lng, pop], ...] }
 *
 * Only rows that have a numeric population are kept (population is the basis of
 * the ranking). Coordinates are rounded to 4 decimals (~11 m) to shrink the file.
 *
 * ---------------------------------------------------------------------------
 * FULL / EXACT DATA (covers all ~8.1B incl. rural, no city approximation):
 *   Use a gridded population raster instead of a city list:
 *     - NASA SEDAC GPWv4  (https://sedac.ciesin.columbia.edu) ~1 km cells, or
 *     - WorldPop          (https://www.worldpop.org)          ~100 m / 1 km cells.
 *   Download the population-count GeoTIFF, then in a build script downsample it
 *   (e.g. to 0.25-1.0 deg cells) and emit one [lat, lng, pop] entry per non-zero
 *   cell directly into assets/cities.json. That replaces BOTH steps below and
 *   needs no rural approximation. Full-resolution rasters are hundreds of MB to
 *   GB, so always downsample before bundling into the app (or serve via API).
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

function parseCsvLine(line) {
    // Minimal CSV parser handling quoted fields and embedded commas/quotes.
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            out.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out;
}

function main() {
    const inputPath = process.argv[2];
    if (!inputPath) {
        console.error('Usage: node scripts/build-cities.js path/to/worldcities.csv');
        process.exit(1);
    }
    if (!fs.existsSync(inputPath)) {
        console.error(`File not found: ${inputPath}`);
        process.exit(1);
    }

    const raw = fs.readFileSync(inputPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) {
        console.error('CSV is empty.');
        process.exit(1);
    }

    const header = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
    const latIdx = header.indexOf('lat');
    const lngIdx = header.indexOf('lng');
    const popIdx = header.indexOf('population');
    if (latIdx === -1 || lngIdx === -1 || popIdx === -1) {
        console.error('CSV must contain lat, lng and population columns. Found:', header.join(', '));
        process.exit(1);
    }

    const cities = [];
    let totalPopulation = 0;
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const lat = parseFloat(cols[latIdx]);
        const lng = parseFloat(cols[lngIdx]);
        const pop = parseFloat(cols[popIdx]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(pop) || pop <= 0) {
            continue;
        }
        cities.push([Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4, Math.round(pop)]);
        totalPopulation += Math.round(pop);
    }

    const outDir = path.join(__dirname, '..', 'assets');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'cities.urban.json');
    const payload = {
        totalPopulation,
        count: cities.length,
        generatedAt: new Date().toISOString(),
        source: 'SimpleMaps World Cities (Basic, CC BY 4.0) - https://simplemaps.com/data/world-cities',
        cities,
    };
    fs.writeFileSync(outPath, JSON.stringify(payload));
    console.log(`Wrote ${cities.length} urban cities (population ${totalPopulation.toLocaleString()}) to ${outPath}`);
    console.log('Next: run  node scripts/build-grid.js  to add rural fill and write assets/cities.json');
}

main();
