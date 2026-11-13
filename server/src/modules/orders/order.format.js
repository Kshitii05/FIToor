const rupees = new Intl.NumberFormat('en-IN');

/** 120000 -> "₹1,200"; 120050 -> "₹1,200.50". Integer arithmetic only. */
export function formatPaise(paise) {
  const whole = Math.trunc(paise / 100);
  const fraction = paise % 100;
  return fraction === 0
    ? `₹${rupees.format(whole)}`
    : `₹${rupees.format(whole)}.${String(fraction).padStart(2, '0')}`;
}
