import L from 'leaflet';
import { useCallback, useState } from 'react';

// OpenStreetMap's standard tiles. Their usage policy requires this credit line; a
// production tile provider is a launch check (DECISIONS I46).
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Creates a Leaflet map in the element the returned ref is attached to, and removes
 * it when the element goes away. Returns `[ref, map]`; `map` is null until ready.
 * `center` and `zoom` only set the first view.
 */
export function useLeafletMap({ center, zoom, interactive = true }) {
  const [map, setMap] = useState(null);

  const ref = useCallback(
    (element) => {
      if (!element) return undefined;
      const created = L.map(element, {
        center: [center.lat, center.lng],
        zoom,
        scrollWheelZoom: false,
        dragging: interactive,
        touchZoom: interactive,
        doubleClickZoom: interactive,
        boxZoom: interactive,
        keyboard: interactive,
        zoomControl: interactive,
      });
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(created);
      // The element may not have its final size yet (a card that just opened).
      const resize = new ResizeObserver(() => created.invalidateSize());
      resize.observe(element);
      setMap(created);
      return () => {
        resize.disconnect();
        created.remove();
        setMap(null);
      };
    },
    // Only the first view comes from props; later changes are applied by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return [ref, map];
}

/** A round marker drawn with CSS, so no marker image files are needed. */
export function dotIcon(label = '') {
  return L.divIcon({
    className: '',
    html: `<span class="map-dot">${label}</span>`,
    iconSize: label ? [30, 30] : [20, 20],
    iconAnchor: label ? [15, 15] : [10, 10],
  });
}
