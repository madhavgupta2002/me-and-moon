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
function rank(uLat, uLon, sLat, sLon) {
    const u = angDeg(uLat, uLon, sLat, sLon);
    let closer = 0;
    for (const c of citiesData.cities) if (angDeg(c[0], c[1], sLat, sLon) < u) closer += c[2];
    return { u, closer, rank: closer + 1, pct: closer / citiesData.totalPopulation };
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

const uA = angDeg(-sub.lat, normLon(sub.lon + 180), sub.lat, sub.lon);
console.log('  userAngular at antipode (expect ~180):', uA.toFixed(4));
const excluded = citiesData.cities
    .map((c) => ({ c, a: angDeg(c[0], c[1], sub.lat, sub.lon) }))
    .filter((x) => !(x.a < uA))
    .sort((p, q) => q.c[2] - p.c[2])
    .slice(0, 8);
console.log('  top excluded:', excluded.map((x) => `${x.c[2]}@${x.a.toFixed(2)}°`).join(', '));
