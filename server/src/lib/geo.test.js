import { describe, expect, it } from 'vitest';
import { LOCATION_GRID_DEGREES } from '../config/policy.js';
import { publicPoint, roundOrigin } from './geo.js';

describe('the public point of a listing', () => {
  it('is the centre of the grid square the pin is in', () => {
    const shown = publicPoint({ lat: 12.97194, lng: 77.64115 });
    const half = LOCATION_GRID_DEGREES / 2;

    expect(Math.abs(shown.lat - 12.97194)).toBeLessThanOrEqual(half);
    expect(Math.abs(shown.lng - 77.64115)).toBeLessThanOrEqual(half);
    // A centre: halfway between two grid lines.
    expect((shown.lat / LOCATION_GRID_DEGREES) % 1).toBeCloseTo(0.5, 4);
    expect((shown.lng / LOCATION_GRID_DEGREES) % 1).toBeCloseTo(0.5, 4);
  });

  it('is the same for every pin in the same square', () => {
    const corner = publicPoint({ lat: 12.9735, lng: 77.6385 });
    const a = { lat: corner.lat - 0.002, lng: corner.lng - 0.002 };
    const b = { lat: corner.lat + 0.002, lng: corner.lng + 0.0015 };

    expect(publicPoint(a)).toEqual(publicPoint(b));
    expect(publicPoint(a)).toEqual(corner);
  });

  it('never equals the pin, so the exact spot cannot be read from it', () => {
    const pin = { lat: 12.97194, lng: 77.64115 };
    expect(publicPoint(pin)).not.toEqual(pin);
  });
});

describe('a device position used as a search origin', () => {
  it('is rounded to 3 decimals, about 100 m', () => {
    expect(roundOrigin({ lat: 12.971634, lng: 77.594562 })).toEqual({ lat: 12.972, lng: 77.595 });
  });
});
