// Names and limits for listings. The limits mirror the server's policy values so the
// form can guide people; the server remains the authority and re-checks everything.

export const CATEGORIES = [
  { value: 'ETHNIC_WEAR', label: 'Ethnic wear' },
  { value: 'WESTERN_WEAR', label: 'Western wear' },
  { value: 'FOOTWEAR', label: 'Footwear' },
  { value: 'ACCESSORIES', label: 'Accessories' },
  { value: 'BAGS', label: 'Bags' },
  { value: 'FORMAL_WEAR', label: 'Formal wear' },
];

export const CONDITIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'GOOD', label: 'Good' },
  { value: 'FAIR', label: 'Fair' },
];

export const STATUSES = [
  { value: 'ACTIVE', label: 'Active', tone: 'success' },
  { value: 'PAUSED', label: 'Paused', tone: 'neutral' },
  { value: 'UNDER_REVIEW', label: 'Under review', tone: 'notice' },
  { value: 'REMOVED', label: 'Removed', tone: 'danger' },
];

const labelOf = (list) => (value) => list.find((item) => item.value === value)?.label ?? value;

export const categoryLabel = labelOf(CATEGORIES);
export const conditionLabel = labelOf(CONDITIONS);
export const statusInfo = (value) =>
  STATUSES.find((status) => status.value === value) ?? { label: value, tone: 'neutral' };

export const LIMITS = {
  titleMin: 5,
  titleMax: 80,
  descriptionMin: 10,
  descriptionMax: 2000,
  brandMax: 60,
  sizeMax: 20,
  colourMax: 30,
  quantityMax: 99,
  imagesMin: 1,
  imagesMax: 8,
  imageMaxBytes: 5 * 1024 * 1024,
  imageTypes: ['image/jpeg', 'image/png', 'image/webp'],
  packagesMax: 6,
  packageMaxDays: 30,
  packagePresetDays: [1, 3, 7],
  radiusMinKm: 1,
  radiusMaxKm: 50,
};

export function daysLabel(days) {
  return days === 1 ? '1 day' : `${days} days`;
}

/** The headline price of a listing: its sale price, or its cheapest rental package. */
export function headlinePrice(listing) {
  if (listing.sale) return { paise: listing.sale.pricePaise, note: null };
  const cheapest = listing.rent.packages.reduce((a, b) => (b.pricePaise < a.pricePaise ? b : a));
  return { paise: cheapest.pricePaise, note: `for ${daysLabel(cheapest.durationDays)}` };
}
