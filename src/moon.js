// moon.js — Moon position helpers built on astronomy-engine (MIT).
//
// The "sub-lunar point" is the location on Earth's surface where the Moon is
// directly overhead (at the zenith). A person's straight-line distance to the
// Moon depends only on their angular distance from this point, so it is the
// anchor for the whole ranking.

import {
    Body,
    MakeTime,
    GeoVector,
    Rotation_EQJ_EQD,
    RotateVector,
    EquatorFromVector,
    SiderealTime,
    KM_PER_AU,
} from 'astronomy-engine';

// Normalize a longitude into the range [-180, 180).
function normalizeLongitude(lonDeg) {
    let lon = ((lonDeg + 180) % 360 + 360) % 360 - 180;
    // Guard against -180 turning into +180 due to floating point.
    if (lon === 180) lon = -180;
    return lon;
}

/**
 * Compute the sub-lunar point and the Earth-center-to-Moon distance.
 *
 * @param {Date} [date] Defaults to now.
 * @returns {{ lat: number, lon: number, distanceKm: number }}
 *   lat/lon in degrees; distanceKm is the geocentric distance to the Moon.
 */
export function getSubLunarPoint(date = new Date()) {
    const time = MakeTime(date);

    // Geocentric Moon vector in the J2000 equatorial frame (AU).
    const eqj = GeoVector(Body.Moon, time, false);

    // Rotate into the equator-of-date frame so RA aligns with sidereal time.
    const eqd = RotateVector(Rotation_EQJ_EQD(time), eqj);

    // Right ascension (sidereal hours), declination (deg), distance (AU).
    const equ = EquatorFromVector(eqd);

    // Greenwich Apparent Sidereal Time in sidereal hours.
    const gast = SiderealTime(time);

    const lat = equ.dec;
    const lon = normalizeLongitude((equ.ra - gast) * 15);
    const distanceKm = equ.dist * KM_PER_AU;

    return { lat, lon, distanceKm };
}

export { normalizeLongitude };
