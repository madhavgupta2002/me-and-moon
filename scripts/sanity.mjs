// Temporary sanity check (not part of the app). Validates the sub-lunar point
// computation and the ranking edges using the real astronomy-engine + data.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
    Body, MakeTime, GeoVector, Rotation_EQJ_EQD, RotateVector,
    EquatorFromVector, SiderealTime, KM_PER_AU,
} = require('astronomy-engine');
import { readFileSync } from 'fs';

const citiesData = JSON.parse(readFileSync(new URL('../assets/cities.json', import.meta.url)));

const EARTH_RADIUS_KM = 6371.0088;
function normLon(d) { let l = ((d + 180) % 360 + 360) % 360 - 180; return l === 180 ? -180 : l; }
function getSubLunarPoint(date) {
    const t = MakeTime(date);
    const eqd = RotateVector(Rotation_EQJ_EQD(t), GeoVector(Body.Moon, t, false));
    const equ = EquatorFromVector(eqd);
    return { lat: equ.dec, lon: normLon((equ.ra - SiderealTime(t)) * 15), distanceKm: equ.dist * KM_PER_AU };
}
const toRad = (d) => d * Math.PI / 180;
function angDeg(a, b, c, d) {
    const p1 = toRad(a), p2 = toRad(c), dp = toRad(c - a), dl = toRad(d - b);
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    const hc = Math.min(1, Math.max(0, h));
    return 2 * Math.atan2(Math.sqrt(hc), Math.sqrt(1 - hc)) * 180 / Math.PI;
}
const surfaceKm = (a, b, c, d) => toRad(angDeg(a, b, c, d)) * EARTH_RADIUS_KM;
// Mirror of src/rank.js: distribute each city over a disk and count the fraction
// of that disk inside the user's cap.
const DENSITY = 3000, RMIN = 1.5, RMAX = 60;
const clampUnit = (x) => Math.min(1, Math.max(-1, x));
function cityRadiusKm(pop) {
    return Math.min(RMAX, Math.max(RMIN, Math.sqrt(Math.max(0, pop) / (Math.PI * DENSITY))));
}
function circleOverlapArea(dist, r0, r1) {
    if (r0 <= 0 || r1 <= 0) return 0;
    if (dist >= r0 + r1) return 0;
    if (dist <= Math.abs(r0 - r1)) { const m = Math.min(r0, r1); return Math.PI * m * m; }
    const r0s = r0 * r0, r1s = r1 * r1;
    const a0 = r0s * Math.acos(clampUnit((dist * dist + r0s - r1s) / (2 * dist * r0)));
    const a1 = r1s * Math.acos(clampUnit((dist * dist + r1s - r0s) / (2 * dist * r1)));
    const tri = 0.5 * Math.sqrt(Math.max(0, (-dist + r0 + r1) * (dist + r0 - r1) * (dist - r0 + r1) * (dist + r0 + r1)));
    return a0 + a1 - tri;
}
function rank(uLat, uLon, sLat, sLon) {
    const u = angDeg(uLat, uLon, sLat, sLon);
    const cap = surfaceKm(uLat, uLon, sLat, sLon);
    let closer = 0;
    for (const c of citiesData.cities) {
        const r = cityRadiusKm(c[2]);
        const frac = circleOverlapArea(surfaceKm(c[0], c[1], sLat, sLon), cap, r) / (Math.PI * r * r);
        closer += frac * c[2];
    }
    return { u, closer, rank: Math.round(closer) + 1, pct: closer / citiesData.totalPopulation };
}

const sub = getSubLunarPoint(new Date());
console.log('Sub-lunar point:', sub.lat.toFixed(3), sub.lon.toFixed(3), 'distKm', Math.round(sub.distanceKm));
console.log('  lat in [-90,90]?', sub.lat >= -90 && sub.lat <= 90);
console.log('  lon in [-180,180)?', sub.lon >= -180 && sub.lon < 180);
console.log('  Moon distance plausible (356000-407000 km)?', sub.distanceKm > 356000 && sub.distanceKm < 407000);

// At the sub-lunar point -> rank should be ~1.
const atPoint = rank(sub.lat, sub.lon, sub.lat, sub.lon);
console.log('At sub-lunar point: rank', atPoint.rank, '(expect 1)');

// At the antipode -> rank should be ~total population.
const anti = rank(-sub.lat, normLon(sub.lon + 180), sub.lat, sub.lon);
console.log('At antipode: rank', anti.rank.toLocaleString(), 'of', citiesData.totalPopulation.toLocaleString());
console.log('  antipode percentile closer ~1?', anti.pct.toFixed(4));

// Gradient check: put the sub-lunar point on top of the biggest city, then step
// the user outward a few km. With the disk model the "closer" count should grow
// smoothly from a small number (not snap from 0 to the whole metro at once).
const biggest = [...citiesData.cities].sort((a, b) => b[2] - a[2])[0];
const [bLat, bLon, bPop] = biggest;
console.log(`\nGradient test around biggest city (pop ${bPop.toLocaleString()}):`);
function kmNorth(lat, lon, km) {
    return [lat + (km / 111.0), lon];
}
let prev = -1, monotonic = true;
for (const km of [0.5, 1, 2, 5, 10, 20]) {
    const [uLat, uLon] = kmNorth(bLat, bLon, km);
    const r = rank(uLat, uLon, bLat, bLon);
    if (r.closer < prev - 1e-6) monotonic = false;
    prev = r.closer;
    console.log(`  user ${String(km).padStart(4)} km out -> ${Math.round(r.closer).toLocaleString()} people closer`);
}
console.log('  grows monotonically with distance?', monotonic);

