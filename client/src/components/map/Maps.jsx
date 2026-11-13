import L from 'leaflet';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { distanceLabel, INDIA_VIEW } from '../../lib/location.js';
import { formatPaise } from '../../lib/money.js';
import { headlinePrice } from '../../lib/listings.js';
import { dotIcon, useLeafletMap } from './useLeafletMap.js';

const frame = 'overflow-hidden rounded-card border border-line bg-paper';

/**
 * A map for choosing a spot: click anywhere or drag the marker. `pin` is the
 * current spot or null; `onPick({ lat, lng })` receives each new choice.
 * `focus` moves the view (for example after a place search) without moving the pin.
 */
export function PinMap({ pin, focus, onPick, className = 'h-72' }) {
  const start = pin ?? focus;
  const [ref, map] = useLeafletMap({
    center: start ?? INDIA_VIEW.center,
    zoom: start ? 15 : INDIA_VIEW.zoom,
  });

  useEffect(() => {
    if (!map) return undefined;
    const handleClick = (event) => onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    map.on('click', handleClick);
    return () => map.off('click', handleClick);
  }, [map, onPick]);

  useEffect(() => {
    if (!map || !pin) return undefined;
    const marker = L.marker([pin.lat, pin.lng], {
      icon: dotIcon(),
      draggable: true,
      keyboard: true,
      title: 'Drag to move',
    }).addTo(map);
    marker.on('dragend', () => {
      const { lat, lng } = marker.getLatLng();
      onPick({ lat, lng });
    });
    return () => marker.remove();
  }, [map, pin, onPick]);

  useEffect(() => {
    if (map && focus) map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 15));
  }, [map, focus]);

  return (
    <div
      ref={ref}
      className={`${frame} ${className}`}
      role="application"
      aria-label="Map. Click to place the pin, or drag the pin to move it."
    />
  );
}

// About the size of the ~500 m square a listing is shown in.
const AREA_RADIUS_M = 400;

/** Where a listing is, approximately: a shaded circle, never a pin. */
export function AreaMap({ point, className = 'h-56' }) {
  const [ref, map] = useLeafletMap({ center: point, zoom: 14, interactive: false });

  useEffect(() => {
    if (!map) return undefined;
    const circle = L.circle([point.lat, point.lng], {
      radius: AREA_RADIUS_M,
      color: '#2f5d50',
      weight: 1.5,
      fillColor: '#2f5d50',
      fillOpacity: 0.18,
    }).addTo(map);
    map.setView([point.lat, point.lng], 14);
    return () => circle.remove();
  }, [map, point]);

  return (
    <div
      ref={ref}
      className={`${frame} ${className}`}
      role="img"
      aria-label="Map of the approximate area"
    />
  );
}

/**
 * Search results on a map. Listings shown at the same approximate spot share one
 * numbered marker; its popup lists them with links.
 */
export function ResultsMap({ listings, className = 'h-[28rem]' }) {
  const navigate = useNavigate();
  const [ref, map] = useLeafletMap({ center: INDIA_VIEW.center, zoom: INDIA_VIEW.zoom });

  useEffect(() => {
    if (!map) return undefined;
    const groups = new Map();
    for (const listing of listings) {
      if (!listing.location) continue;
      const key = `${listing.location.lat},${listing.location.lng}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(listing);
    }

    const layer = L.layerGroup().addTo(map);
    for (const items of groups.values()) {
      const { lat, lng, locality } = items[0].location;
      const marker = L.marker([lat, lng], {
        icon: dotIcon(items.length > 1 ? String(items.length) : ''),
        title: `${items.length} ${items.length === 1 ? 'listing' : 'listings'} near ${locality}`,
        keyboard: true,
      }).addTo(layer);

      // Popup content is built from DOM nodes, so listing text is never parsed as HTML.
      const content = document.createElement('div');
      const heading = document.createElement('p');
      heading.className = 'map-popup-area';
      heading.textContent = `Around ${locality}`;
      content.append(heading);
      const list = document.createElement('ul');
      list.className = 'map-popup-list';
      for (const listing of items) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/listings/${listing.id}`;
        link.textContent = listing.title;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          navigate(`/listings/${listing.id}`);
        });
        const meta = document.createElement('span');
        const { paise, note } = headlinePrice(listing);
        meta.textContent = [
          formatPaise(paise) + (note ? ` ${note}` : ''),
          distanceLabel(listing.distanceKm),
        ]
          .filter(Boolean)
          .join(' · ');
        item.append(link, meta);
        list.append(item);
      }
      content.append(list);
      marker.bindPopup(content);
    }

    const points = [...groups.values()].map((items) => [
      items[0].location.lat,
      items[0].location.lng,
    ]);
    if (points.length === 1) map.setView(points[0], 14);
    if (points.length > 1) map.fitBounds(points, { padding: [32, 32], maxZoom: 15 });
    return () => layer.remove();
  }, [map, listings, navigate]);

  return (
    <div
      ref={ref}
      className={`${frame} ${className}`}
      role="region"
      aria-label="Map of the results"
    />
  );
}
