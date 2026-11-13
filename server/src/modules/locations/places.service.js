import { APP_NAME } from '../../config/app.js';
import { env } from '../../config/env.js';
import {
  ALLOWED_AREA,
  PLACE_LOOKUP_CACHE_DAYS,
  PLACE_LOOKUP_MIN_INTERVAL_MS,
  PLACE_RESULTS_MAX,
} from '../../config/policy.js';
import { AppError } from '../../lib/errors.js';
import { roundOrigin } from '../../lib/geo.js';
import { getRedis } from '../../lib/redis.js';

// Turns place names and PIN codes into map points, and map points into area names,
// using OpenStreetMap's Nominatim service (DECISIONS I39). Its usage policy asks for
// at most one request per second, an identifying User-Agent and caching, so every
// answer is cached and requests wait their turn. Positions sent to it are rounded
// to about 100 m first.

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const REQUEST_TIMEOUT_MS = 5000;
const CACHE_SECONDS = PLACE_LOOKUP_CACHE_DAYS * 24 * 60 * 60;

const unavailable = () =>
  new AppError(
    503,
    'PLACES_UNAVAILABLE',
    'Place search is not available right now. Drop a pin on the map instead.',
  );

/** A cache backed by Redis. */
export function createRedisPlaceCache() {
  return {
    async get(key) {
      const value = await getRedis().get(key);
      return value === null ? null : JSON.parse(value);
    },
    async set(key, value) {
      await getRedis().set(key, JSON.stringify(value), 'EX', CACHE_SECONDS);
    },
  };
}

const roundCoordinate = (value) => Math.round(value * 1e5) / 1e5;

const insideArea = ({ lat, lng }) =>
  lat >= ALLOWED_AREA.minLat &&
  lat <= ALLOWED_AREA.maxLat &&
  lng >= ALLOWED_AREA.minLng &&
  lng <= ALLOWED_AREA.maxLng;

/** The area name and city of a Nominatim address. */
function namesFrom(address = {}) {
  const locality =
    address.suburb ??
    address.neighbourhood ??
    address.quarter ??
    address.city_district ??
    address.town ??
    address.village ??
    address.city ??
    address.county ??
    address.state_district ??
    null;
  const city = address.city ?? address.town ?? address.state_district ?? address.state ?? null;
  return { locality, city: city === locality ? null : city, pincode: address.postcode ?? null };
}

function toPlace(result) {
  const names = namesFrom(result.address);
  const locality = names.locality ?? result.name ?? null;
  if (!locality) return null;
  return {
    locality,
    city: names.city,
    pincode: names.pincode,
    label: [locality, names.city].filter(Boolean).join(', '),
    lat: roundCoordinate(Number(result.lat)),
    lng: roundCoordinate(Number(result.lon)),
  };
}

/**
 * `fetchFn`, `cache`, `now` and `sleep` can be replaced in tests.
 * Returns `{ search(text), reverse({ lat, lng }) }`.
 */
export function createPlaceLookup({
  fetchFn = globalThis.fetch,
  cache = createRedisPlaceCache(),
  logger = console,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const userAgent = `${APP_NAME}/0.1 (${env.GEOCODER_CONTACT ?? 'development'})`;
  let lastRequestAt = -Infinity;
  let queue = Promise.resolve();

  /** Runs requests one at a time, at least the minimum interval apart. */
  function inTurn(task) {
    const run = queue.then(async () => {
      const wait = lastRequestAt + PLACE_LOOKUP_MIN_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();
      return task();
    });
    queue = run.catch(() => {});
    return run;
  }

  async function request(path, params) {
    const url = `${NOMINATIM}${path}?${new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      'accept-language': 'en',
      ...params,
    })}`;
    let response;
    try {
      response = await inTurn(() =>
        fetchFn(url, {
          headers: { 'User-Agent': userAgent, Accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      );
    } catch (error) {
      logger.error(error);
      throw unavailable();
    }
    if (!response.ok) {
      logger.error(new Error(`Place lookup failed with status ${response.status}`));
      throw unavailable();
    }
    return response.json();
  }

  async function cached(key, load) {
    const hit = await cache.get(key).catch(() => null);
    if (hit !== null) return hit;
    const value = await load();
    await cache.set(key, value).catch((error) => logger.error(error));
    return value;
  }

  return {
    /** Places in India matching a city, area or PIN code. */
    search(text) {
      const query = text.trim().replace(/\s+/g, ' ').toLowerCase();
      return cached(`places:search:${query}`, async () => {
        const results = await request('/search', {
          q: query,
          countrycodes: 'in',
          limit: String(PLACE_RESULTS_MAX),
        });
        const seen = new Set();
        return results
          .map(toPlace)
          .filter((place) => place && insideArea(place))
          .filter((place) => {
            const key = place.label.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
      });
    },

    /** The area name for a map point, or null when it has none. */
    reverse(point) {
      const { lat, lng } = roundOrigin(point);
      return cached(`places:reverse:${lat},${lng}`, async () => {
        const result = await request('/reverse', {
          lat: String(lat),
          lon: String(lng),
          zoom: '16',
        });
        if (!result || result.error) return null;
        const { locality, city } = namesFrom(result.address);
        return locality
          ? { locality, city, label: [locality, city].filter(Boolean).join(', ') }
          : null;
      });
    },
  };
}
