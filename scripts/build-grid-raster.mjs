#!/usr/bin/env node
/*
 * build-grid-raster.mjs  —  ingest a REAL gridded population raster.
 *
 * This is the "full data" path. Instead of approximating rural population from a
 * city list (build-cities.js + build-grid.js), it reads an actual global
 * population-COUNT GeoTIFF and downsamples it to a compact grid the app bundles.
 * Because the raster already contains everyone — urban AND rural, everywhere on
 * land — there are no coverage holes (the bug where a sub-lunar point over a
 * region missing from the city list reported "0 people closer").
 *
 * Source raster (free, no login, direct download):
 *   WorldPop "Unconstrained global mosaic" 2020, 1km, population count:
 *   https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/0_Mosaicked/ppp_2020_1km_Aggregated.tif
 *   (~829 MB; ~7.8B people. Download once into ./.data/ — it is gitignored and
 *    never bundled. Only the downsampled JSON below ships with the app.)
 *
 * Alternatives that work unchanged with this script (any WGS84 population-COUNT
 * GeoTIFF): NASA SEDAC GPWv4 (population count) at 15-arcmin/30-arcmin/1-deg, or
 * other WorldPop years. Population-DENSITY rasters would need multiplying by cell
 * area first — use population COUNT to keep this simple.
 *
 * Usage:
 *   node scripts/build-grid-raster.mjs [path-to.tif] [targetDeg]
 *   # defaults: .data/worldpop_2020_1km.tif  and  0.25 deg cells
 *
 * Output:
 *   assets/cities.json -> { totalPopulation, count, generatedAt, source, cities: [[lat, lng, pop], ...] }
 *
 * Memory: the source is read in horizontal row bands so we never hold the whole
 * 43200x18720 raster (multi-GB) in memory at once.
 */

import { fromFile } from 'geotiff';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2] || join(__dirname, '..', '.data', 'worldpop_2020_1km.tif');
const TARGET_DEG = parseFloat(process.argv[3] || '0.25'); // output cell size
const MIN_CELL_POP = 50; // drop near-empty cells to keep the file small
const BAND_ROWS = 512;   // source rows per read (bounds memory)

function isNoData(v, nodata) {
    if (!Number.isFinite(v)) return true;
    if (nodata != null && v === nodata) return true;
    // WorldPop uses a large negative / huge sentinel for "no data".
    return v < 0 || v > 1e12;
}

async function main() {
    console.log(`Reading ${inputPath} ...`);
    const tiff = await fromFile(inputPath);
    const img = await tiff.getImage();
    const width = img.getWidth();
    const height = img.getHeight();
    const [minX, minY, maxX, maxY] = img.getBoundingBox(); // lon/lat degrees (WGS84)
    const nodata = img.getGDALNoData();
    const pxW = (maxX - minX) / width;
    const pxH = (maxY - minY) / height;
    console.log(`  ${width} x ${height} px, bbox [${minX.toFixed(2)},${minY.toFixed(2)} .. ${maxX.toFixed(2)},${maxY.toFixed(2)}], nodata=${nodata}`);

    const nLon = Math.round(360 / TARGET_DEG);
    const nLat = Math.round(180 / TARGET_DEG);
    const sums = new Float64Array(nLon * nLat); // accumulate population per output cell

    let processed = 0;
    for (let y0 = 0; y0 < height; y0 += BAND_ROWS) {
        const y1 = Math.min(height, y0 + BAND_ROWS);
        const [data] = await img.readRasters({ window: [0, y0, width, y1] });
        const rows = y1 - y0;
        for (let r = 0; r < rows; r++) {
            // Pixel-center latitude for this source row.
            const lat = maxY - (y0 + r + 0.5) * pxH;
            const outLatIdx = Math.min(nLat - 1, Math.max(0, Math.floor((90 - lat) / TARGET_DEG)));
            const base = r * width;
            for (let c = 0; c < width; c++) {
                const v = data[base + c];
                if (isNoData(v, nodata) || v === 0) continue;
                const lon = minX + (c + 0.5) * pxW;
                const outLonIdx = Math.min(nLon - 1, Math.max(0, Math.floor((lon + 180) / TARGET_DEG)));
                sums[outLatIdx * nLon + outLonIdx] += v;
            }
        }
        processed = y1;
        process.stdout.write(`\r  rows ${processed}/${height}`);
    }
    process.stdout.write('\n');

    const cities = [];
    let totalPopulation = 0;
    for (let li = 0; li < nLat; li++) {
        const cellLat = 90 - (li + 0.5) * TARGET_DEG;
        for (let oi = 0; oi < nLon; oi++) {
            const pop = sums[li * nLon + oi];
            if (pop < MIN_CELL_POP) continue;
            const cellLon = -180 + (oi + 0.5) * TARGET_DEG;
            const p = Math.round(pop);
            cities.push([Math.round(cellLat * 1e4) / 1e4, Math.round(cellLon * 1e4) / 1e4, p]);
            totalPopulation += p;
        }
    }

    const payload = {
        totalPopulation,
        count: cities.length,
        generatedAt: new Date().toISOString(),
        source: `WorldPop/GPW population-count raster downsampled to ${TARGET_DEG}\u00b0 cells (population count, WGS84)`,
        cities,
    };
    const outPath = join(__dirname, '..', 'assets', 'cities.json');
    writeFileSync(outPath, JSON.stringify(payload));
    console.log(`Wrote ${cities.length} grid cells, total population ${totalPopulation.toLocaleString()} -> ${outPath}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
