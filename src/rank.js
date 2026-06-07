// rank.js — population-based proximity ranking.
//
// Everyone whose angular distance to the sub-lunar point is smaller than yours
// is physically closer to the Moon than you. We approximate "everyone" with the
// bundled city dataset: sum the population of all cities inside your spherical
// cap (the circle centered on the sub-lunar point that just reaches you).

import { angularDistanceDeg } from './geo';

/**
 * @param {number} userLat
 * @param {number} userLon
 * @param {number} subLat   Sub-lunar point latitude.
 * @param {number} subLon   Sub-lunar point longitude.
 * @param {{ totalPopulation: number, cities: number[][] }} citiesData
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

    let closerPopulation = 0;
    const cities = citiesData.cities;
    for (let i = 0; i < cities.length; i++) {
        const c = cities[i];
        const cityAngular = angularDistanceDeg(c[0], c[1], subLat, subLon);
        if (cityAngular < userAngularDeg) {
            closerPopulation += c[2];
        }
    }

    const totalPopulation = citiesData.totalPopulation;
    // Rank 1 means nobody is closer than you.
    const rank = closerPopulation + 1;
    const percentileCloser = totalPopulation > 0 ? closerPopulation / totalPopulation : 0;

    return { userAngularDeg, closerPopulation, totalPopulation, rank, percentileCloser };
}
