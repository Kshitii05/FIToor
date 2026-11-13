// Location helpers for the browser. Distances are never worked out here: the
// server measures them with PostGIS and sends them back.

/** The box around India the server accepts. */
export const ALLOWED_AREA = { minLat: 6, maxLat: 37.5, minLng: 68, maxLng: 97.5 };

/** Where maps start when nothing better is known: all of India. */
export const INDIA_VIEW = { center: { lat: 22.5, lng: 79 }, zoom: 4 };

export const RADIUS_OPTIONS_KM = [2, 5, 10, 25, 50];

export function insideAllowedArea({ lat, lng }) {
  return (
    lat >= ALLOWED_AREA.minLat &&
    lat <= ALLOWED_AREA.maxLat &&
    lng >= ALLOWED_AREA.minLng &&
    lng <= ALLOWED_AREA.maxLng
  );
}

/** A device position rounded to about 100 m: as precise as a search ever needs. */
export function roundPosition({ lat, lng }) {
  const round = (value) => Math.round(value * 1000) / 1000;
  return { lat: round(lat), lng: round(lng) };
}

/**
 * Asks the browser for the device's position. Only call this after the person has
 * asked for it (a button press): the browser shows its own permission prompt.
 */
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot share its location. Pick a place instead.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position = { lat: coords.latitude, lng: coords.longitude };
        if (!insideAllowedArea(position)) {
          reject(new Error('Your location seems to be outside India. Pick a place instead.'));
          return;
        }
        resolve(position);
      },
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? 'Location access was turned down. You can pick a place instead.'
              : 'Could not get your location. Try again, or pick a place.',
          ),
        ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

/** "Less than 1 km away", "2.5 km away". */
export function distanceLabel(km) {
  if (km === null || km === undefined) return null;
  return km < 1 ? 'Less than 1 km away' : `${km} km away`;
}
