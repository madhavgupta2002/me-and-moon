// rank.js — population-based proximity ranking.
//
// Everyone whose straight-line distance to the Moon is smaller than yours is
// "closer" than you. Because the Moon is ~385,000 km away, "closer to the Moon"
// is equivalent to "closer to the sub-lunar point on the ground": both reduce to
// a smaller surface distance from that point. So we count people inside the
// spherical cap centered on the sub-lunar point whose edge passes through you.
//
// The bundled dataset stores each city as a single coordinate, but a metro of
// millions actually covers tens of km². If we treated each city as a zero-size
// point, the rank would snap an entire metro in or out the instant the cap edge
// crossed its centroid — so standing 5 km from the sub-lunar point inside a huge
// city would wrongly report "0 people closer". Instead we give every city a
// physical footprint (a disk sized from its population) and count the *fraction*
// of that disk lying inside your cap. That yields a smooth, realistic gradient:
// move a little and the rank changes by people, not by whole cities.

import { angularDistanceDeg, surfaceDistanceKm, circleOverlapArea } from './geo';

// Average inhabited density used to turn a population count into a ground radius.
// area = pop / density, radius = sqrt(area / pi). ~3000 people/km² is a typical
// metro-wide average (dense cores balance sparse outskirts).
const DEFAULT_DENSITY_PER_KM2 = 3000;
// Clamp the footprint so tiny towns aren't infinitely sharp and megacities don't
// sprawl unrealistically far.
const MIN_CITY_RADIUS_KM = 1.5;
const MAX_CITY_RADIUS_KM = 60;

/** Ground radius (km) of a city's population footprint, modeled as a disk. */
export function cityRadiusKm(population, density = DEFAULT_DENSITY_PER_KM2) {
    const r = Math.sqrt(Math.max(0, population) / (Math.PI * density));
    return Math.min(MAX_CITY_RADIUS_KM, Math.max(MIN_CITY_RADIUS_KM, r));
}

/**
 * @param {number} userLat
 * @param {number} userLon
 * @param {number} subLat   Sub-lunar point latitude.
 * @param {number} subLon   Sub-lunar point longitude.
 * @param {{ totalPopulation: number, cities: number[][], density?: number }} citiesData
 *   cities is an array of [lat, lng, population].
 * @returns {{
 *   userAngularDeg: number,
 *   closerPopulation: number,
 *   totalPopulation: number,
 *   rank: number,
 *   percentileCloser: number
 * }}
 */
export function computeRank(userLat, userLon, subLat, subLon, citiesData) {
    const userAngularDeg = angularDistanceDeg(userLat, userLon, subLat, subLon);
    // Cap radius on the ground: the surface distance from the sub-lunar point to
    // you. Anyone whose footprint lies inside this circle is closer than you.
    const capRadiusKm = surfaceDistanceKm(userLat, userLon, subLat, subLon);
    const density = citiesData.density || DEFAULT_DENSITY_PER_KM2;

    let closerPopulation = 0;
    const cities = citiesData.cities;
    for (let i = 0; i < cities.length; i++) {
        const c = cities[i];
        const pop = c[2];
        const cityDistKm = surfaceDistanceKm(c[0], c[1], subLat, subLon);
        const rCity = cityRadiusKm(pop, density);
        // Fraction of this city's disk that falls inside your cap.
        const overlap = circleOverlapArea(cityDistKm, capRadiusKm, rCity);
        const fraction = overlap / (Math.PI * rCity * rCity);
        closerPopulation += fraction * pop;
    }

    const totalPopulation = citiesData.totalPopulation;
    // Rank 1 means nobody is closer than you.
    const rank = Math.round(closerPopulation) + 1;
    const percentileCloser = totalPopulation > 0 ? closerPopulation / totalPopulation : 0;

    return { userAngularDeg, closerPopulation, totalPopulation, rank, percentileCloser };
}
