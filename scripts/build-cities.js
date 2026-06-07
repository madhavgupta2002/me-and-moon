#!/usr/bin/env node
/*
 * build-cities.js
 *
 * Converts the SimpleMaps "World Cities" CSV into a compact JSON asset that the
 * app bundles and loads at runtime.
 *
 * Data source (free tier, CC BY 4.0):
 *   https://simplemaps.com/data/world-cities  ->  "Basic" download (worldcities.csv)
 *
 * Usage:
 *   node scripts/build-cities.js path/to/worldcities.csv
 *
 * Output:
 *   assets/cities.json  ->  { totalPopulation, count, generatedAt, source, cities: [[lat, lng, pop], ...] }
 *
 * Only rows that have a numeric population are kept (population is the basis of
 * the ranking). Coordinates are rounded to 4 decimals (~11 m) to shrink the file.
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
    const outPath = path.join(outDir, 'cities.json');
    const payload = {
        totalPopulation,
        count: cities.length,
        generatedAt: new Date().toISOString(),
        source: 'SimpleMaps World Cities (Basic, CC BY 4.0) - https://simplemaps.com/data/world-cities',
        cities,
    };
    fs.writeFileSync(outPath, JSON.stringify(payload));
    console.log(`Wrote ${cities.length} cities (total population ${totalPopulation.toLocaleString()}) to ${outPath}`);
}

main();
