import { ApiError } from './api.js';
import { LIMITS } from './listings.js';
import { paiseToRupeeInput, rupeesToPaise } from './money.js';

// The listing form keeps what the user typed as text. These functions turn that
// into the API's shape (amounts in whole paise) and back, and place the server's
// validation messages next to the right inputs.

let nextKey = 0;
const newKey = () => {
  nextKey += 1;
  return `row-${nextKey}`;
};

export function newPackageRow(days = '', price = '') {
  return { key: newKey(), days: String(days), price: String(price) };
}

export function emptyListingForm() {
  return {
    title: '',
    description: '',
    category: '',
    condition: '',
    brand: '',
    size: '',
    colour: '',
    price: '',
    quantity: '1',
    deposit: '',
    lateFee: '',
    packages: [newPackageRow(3)],
    pickup: true,
    delivery: false,
    deliveryCharge: '',
    deliveryRadius: '',
  };
}

export function formFromListing(listing) {
  return {
    title: listing.title,
    description: listing.description,
    category: listing.category,
    condition: listing.condition,
    brand: listing.brand,
    size: listing.size,
    colour: listing.colour,
    price: listing.sale ? paiseToRupeeInput(listing.sale.pricePaise) : '',
    quantity: listing.sale ? String(listing.sale.quantity) : '1',
    deposit: listing.rent ? paiseToRupeeInput(listing.rent.depositPaise) : '',
    lateFee: listing.rent ? paiseToRupeeInput(listing.rent.lateFeePerDayPaise) : '',
    packages: listing.rent
      ? listing.rent.packages.map((p) =>
          newPackageRow(p.durationDays, paiseToRupeeInput(p.pricePaise)),
        )
      : [newPackageRow(3)],
    pickup: listing.pickup,
    delivery: listing.delivery !== null,
    deliveryCharge: listing.delivery ? paiseToRupeeInput(listing.delivery.chargePaise) : '',
    deliveryRadius: listing.delivery ? String(listing.delivery.radiusKm) : '',
  };
}

const AMOUNT_MESSAGE = 'Enter an amount in rupees, like 1200 or 1200.50';

function wholeNumber(text) {
  const trimmed = String(text).trim();
  return /^\d{1,4}$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
}

/**
 * Builds the request body for a listing of the given mode.
 * Returns `{ payload, errors }`; when `errors` has entries the payload is not usable.
 * Only what the browser can judge is checked here (is it a number, is it filled in);
 * ranges and lengths are the server's to decide.
 */
export function buildListingPayload(form, mode) {
  const errors = {};
  const payload = {};

  for (const field of ['title', 'description', 'brand', 'size', 'colour']) {
    payload[field] = form[field].trim();
    if (!payload[field]) errors[field] = 'This is required';
  }
  for (const field of ['category', 'condition']) {
    payload[field] = form[field];
    if (!payload[field]) errors[field] = 'Choose one';
  }

  const amount = (field) => {
    const paise = rupeesToPaise(form[field]);
    if (paise === null) errors[field] = AMOUNT_MESSAGE;
    return paise;
  };

  if (mode === 'SALE') {
    payload.pricePaise = amount('price');
    payload.quantity = wholeNumber(form.quantity);
    if (payload.quantity === null) errors.quantity = 'Enter a whole number';
  } else {
    payload.depositPaise = amount('deposit');
    payload.lateFeePerDayPaise = amount('lateFee');
    payload.packages = form.packages.map((row, index) => {
      const durationDays = wholeNumber(row.days);
      const pricePaise = rupeesToPaise(row.price);
      if (durationDays === null) errors[`packages.${index}.days`] = 'Enter a number of days';
      if (pricePaise === null) errors[`packages.${index}.price`] = AMOUNT_MESSAGE;
      return { durationDays, pricePaise };
    });
    if (payload.packages.length === 0) errors.packages = 'Add at least one rental package';
  }

  payload.pickup = form.pickup;
  if (form.delivery) {
    const radiusKm = wholeNumber(form.deliveryRadius);
    if (radiusKm === null) errors.deliveryRadius = 'Enter a distance in km';
    payload.delivery = { chargePaise: amount('deliveryCharge'), radiusKm };
  } else {
    payload.delivery = null;
  }
  if (!form.pickup && !form.delivery) errors.fulfilment = 'Offer delivery, pickup or both';

  return { payload, errors };
}

const SERVER_FIELD = {
  pricePaise: 'price',
  depositPaise: 'deposit',
  lateFeePerDayPaise: 'lateFee',
  'delivery.chargePaise': 'deliveryCharge',
  'delivery.radiusKm': 'deliveryRadius',
  delivery: 'fulfilment',
  pickup: 'fulfilment',
};

function formFieldFor(path) {
  const packageField = /^packages\.(\d+)\.(durationDays|pricePaise)$/.exec(path);
  if (packageField) {
    return `packages.${packageField[1]}.${packageField[2] === 'durationDays' ? 'days' : 'price'}`;
  }
  return SERVER_FIELD[path] ?? path;
}

/**
 * Splits an API error into messages for individual inputs and a message for the
 * form as a whole. Photo problems are reported under `images`.
 */
export function listingErrorsFrom(error) {
  if (!(error instanceof ApiError)) return { fields: {}, form: 'Something went wrong' };

  if (error.code === 'VALIDATION_ERROR') {
    const fields = {};
    for (const { path, message } of error.details ?? []) {
      const field = formFieldFor(path);
      if (!fields[field]) fields[field] = message;
    }
    return { fields, form: Object.keys(fields).length ? null : error.message };
  }

  const photoCodes = ['IMAGE_REQUIRED', 'UNSUPPORTED_IMAGE', 'IMAGE_TOO_LARGE', 'TOO_MANY_IMAGES'];
  if (photoCodes.includes(error.code)) return { fields: { images: error.message }, form: null };

  return { fields: {}, form: error.message };
}

/** Why a chosen file cannot be used as a photo, or null when it can. */
export function photoProblem(file) {
  if (!LIMITS.imageTypes.includes(file.type)) return `${file.name}: use a JPEG, PNG or WebP image`;
  if (file.size > LIMITS.imageMaxBytes) return `${file.name}: photos must be 5 MB or smaller`;
  return null;
}
