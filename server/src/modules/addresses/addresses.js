import { Router } from 'express';
import { z } from 'zod';
import { ADDRESSES_MAX } from '../../config/policy.js';
import { AppError } from '../../lib/errors.js';
import { latitudeSchema, localitySchema, longitudeSchema } from '../../lib/geo.js';
import { phoneSchema } from '../auth/auth.validation.js';

// Delivery addresses: private to their owner. A copy is kept on each paid order and
// shown to that order's seller, because they need it to deliver (SPEC Module 5).

const text = (min, max, message) =>
  z.string(message).trim().min(min, message).max(max, `Use at most ${max} characters`);

const fields = {
  label: text(1, 30, 'Give this address a name, like Home'),
  recipientName: text(2, 60, 'Enter the name of the person receiving it'),
  phone: phoneSchema,
  line1: text(3, 120, 'Enter the house, building and street'),
  line2: text(0, 120)
    .optional()
    .transform((value) => value || null),
  locality: localitySchema,
  city: text(2, 60, 'Enter the city'),
  state: text(2, 60, 'Enter the state'),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9]\d{5}$/, 'Enter a 6-digit PIN code'),
  lat: latitudeSchema,
  lng: longitudeSchema,
  isDefault: z.boolean().optional(),
};

const addressSchema = z.strictObject(fields);
const updateSchema = z
  .strictObject(fields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })
  .refine((value) => (value.lat === undefined) === (value.lng === undefined), {
    message: 'Send both lat and lng, or neither',
    path: ['lat'],
  });
const idParams = z.object({ id: z.uuid() });

/** The shape kept on an order and shown to the buyer and that order's seller. */
export function toAddress(row) {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipientName,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    locality: row.locality,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    lat: row.lat,
    lng: row.lng,
    isDefault: row.isDefault,
  };
}

const ordered = [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }];

export async function loadOwnAddress(db, userId, id) {
  const row = await db.address.findFirst({ where: { id, userId } });
  if (!row) throw AppError.notFound('Address not found');
  return row;
}

async function addAddress({ db, clock }, userId, input) {
  return db.$transaction(async (tx) => {
    // Serialises concurrent saves by one person, so the limit holds.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const count = await tx.address.count({ where: { userId } });
    if (count >= ADDRESSES_MAX) {
      throw new AppError(
        409,
        'TOO_MANY_ADDRESSES',
        `You can save up to ${ADDRESSES_MAX} addresses`,
      );
    }
    const isDefault = count === 0 || input.isDefault === true;
    if (isDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    return tx.address.create({ data: { ...input, userId, isDefault, createdAt: clock.now() } });
  });
}

async function updateAddress({ db }, userId, id, changes) {
  const existing = await loadOwnAddress(db, userId, id);
  const { isDefault, ...rest } = changes;
  if (isDefault === false && existing.isDefault) {
    throw new AppError(409, 'DEFAULT_REQUIRED', 'Choose another address as your default instead');
  }
  return db.$transaction(async (tx) => {
    if (isDefault === true && !existing.isDefault) {
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return tx.address.update({
      where: { id },
      data: { ...rest, ...(isDefault === true ? { isDefault: true } : {}) },
    });
  });
}

async function removeAddress({ db }, userId, id) {
  const existing = await loadOwnAddress(db, userId, id);
  await db.$transaction(async (tx) => {
    await tx.address.delete({ where: { id } });
    if (!existing.isDefault) return;
    const next = await tx.address.findFirst({ where: { userId }, orderBy: [{ createdAt: 'asc' }] });
    if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
  });
}

/** `/me/addresses`: the signed-in person's own addresses. */
export function createAddressesRouter(deps) {
  const router = Router();
  router.use(deps.requireAuth);

  router.get('/', async (req, res) => {
    const rows = await deps.db.address.findMany({
      where: { userId: req.auth.userId },
      orderBy: ordered,
    });
    res.json({ items: rows.map(toAddress) });
  });

  router.post('/', async (req, res) => {
    const input = addressSchema.parse(req.body);
    res.status(201).json({ address: toAddress(await addAddress(deps, req.auth.userId, input)) });
  });

  router.patch('/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    const changes = updateSchema.parse(req.body);
    res.json({ address: toAddress(await updateAddress(deps, req.auth.userId, id, changes)) });
  });

  router.delete('/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    await removeAddress(deps, req.auth.userId, id);
    res.status(204).end();
  });

  return router;
}
