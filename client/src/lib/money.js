// Money is whole paise everywhere. These helpers convert to and from what people
// type and read, using integer arithmetic only: no floating-point amounts.

const rupees = new Intl.NumberFormat('en-IN');

/** 120000 -> "₹1,200"; 120050 -> "₹1,200.50". */
export function formatPaise(paise) {
  const whole = Math.trunc(paise / 100);
  const fraction = paise % 100;
  const text = rupees.format(whole);
  return fraction === 0 ? `₹${text}` : `₹${text}.${String(fraction).padStart(2, '0')}`;
}

/**
 * Reads an amount typed in rupees ("1200", "1,200", "1200.5", "1200.50") as paise.
 * Returns null when it is not a plain amount with at most two decimals.
 */
export function rupeesToPaise(input) {
  const text = String(input).trim().replace(/[,\s]/g, '');
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const whole = Number.parseInt(match[1], 10);
  const fraction = Number.parseInt((match[2] ?? '').padEnd(2, '0'), 10);
  return whole * 100 + fraction;
}

/** Paise as the text to put in a rupee input: 120000 -> "1200", 120050 -> "1200.50". */
export function paiseToRupeeInput(paise) {
  const whole = Math.trunc(paise / 100);
  const fraction = paise % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
}
