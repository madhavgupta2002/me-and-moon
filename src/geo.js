// geo.js — spherical geometry helpers.

export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Great-circle (angular) distance between two lat/lon points, in degrees.
 * Uses the haversine formula for numerical stability at small distances.
 */
export function angularDistanceDeg(lat1, lon1, lat2, lon2) {
    const phi1 = toRad(lat1);
    const phi2 = toRad(lat2);
    const dPhi = toRad(lat2 - lat1);
    const dLambda = toRad(lon2 - lon1);

    const a =
        Math.sin(dPhi / 2) ** 2 +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    // Clamp to [0, 1]: for near-antipodal points floating-point error can push
    // `a` slightly above 1, which would make sqrt(1 - a) NaN.
    const aClamped = Math.min(1, Math.max(0, a));
    const c = 2 * Math.atan2(Math.sqrt(aClamped), Math.sqrt(1 - aClamped));
    return (c * 180) / Math.PI;
}

/** Great-circle surface distance in kilometers. */
export function surfaceDistanceKm(lat1, lon1, lat2, lon2) {
    return (angularDistanceDeg(lat1, lon1, lat2, lon2) * Math.PI / 180) * EARTH_RADIUS_KM;
}

/**
 * Straight-line (chord-through-space) distance from an observer on Earth's
 * surface to the Moon, using the law of cosines in the Earth-Moon triangle.
 *
 * @param {number} angularDistDeg Angular distance from the sub-lunar point.
 * @param {number} moonDistanceKm Earth-center-to-Moon distance.
 * @param {number} [earthRadiusKm]
 * @returns {number} distance in kilometers.
 */
export function userToMoonDistanceKm(angularDistDeg, moonDistanceKm, earthRadiusKm = EARTH_RADIUS_KM) {
    const theta = toRad(angularDistDeg);
    const R = earthRadiusKm;
    const D = moonDistanceKm;
    return Math.sqrt(R * R + D * D - 2 * R * D * Math.cos(theta));
}
