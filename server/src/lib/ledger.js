// The money ledger: append-only rows, each with a unique key that names the event
// it records ("payment:<id>:commission:<order>"). Writing the same key twice is a
// no-op, so replaying an event can never record money twice. The database refuses
// any update or delete of these rows.

/**
 * Writes ledger rows inside the caller's transaction `tx`. Rows whose key already
 * exists are skipped. Zero amounts are not written.
 */
export async function recordLedger(tx, now, rows) {
  const data = rows
    .filter((row) => row.amountPaise > 0)
    .map((row) => ({
      entryKey: row.key,
      type: row.type,
      amountPaise: row.amountPaise,
      checkoutId: row.checkoutId ?? null,
      orderId: row.orderId ?? null,
      paymentId: row.paymentId ?? null,
      refundId: row.refundId ?? null,
      sellerId: row.sellerId ?? null,
      createdAt: now,
    }));
  if (data.length === 0) return;
  await tx.ledgerEntry.createMany({ data, skipDuplicates: true });
}
