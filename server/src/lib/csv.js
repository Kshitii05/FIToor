// CSV export for admin lists and analytics (SPEC Module 10). No dependency: the
// format is small. Cells that a spreadsheet would treat as a formula (starting with
// = + - @, a tab or a carriage return) get a leading apostrophe, so opening a
// downloaded file can never run something a user typed into a listing or a name.

const FORMULA_START = /^[=+\-@\t\r]/;
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The CSV text for `rows`. `columns` is a list of `[header, row => value]`.
 * Lines end with CRLF, as RFC 4180 asks.
 */
export function toCsv(columns, rows) {
  const lines = [columns.map(([header]) => cell(header)).join(',')];
  for (const row of rows) lines.push(columns.map(([, value]) => cell(value(row))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** Rupees with two decimals from integer paise, for people reading a CSV: 123456 → "1234.56". */
export function rupees(paise) {
  if (paise === null || paise === undefined) return null;
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Sends CSV text as a download. A byte-order mark lets spreadsheet apps read UTF-8. */
export function sendCsv(res, filename, text) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(BYTE_ORDER_MARK + text);
}
