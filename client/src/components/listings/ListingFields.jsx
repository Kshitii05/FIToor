import {
  Alert,
  Button,
  Card,
  Checkbox,
  SectionHeading,
  SelectField,
  TextArea,
  TextField,
} from '../ui/index.js';
import { newPackageRow } from '../../lib/listingForm.js';
import { CATEGORIES, CONDITIONS, daysLabel, LIMITS } from '../../lib/listings.js';

function ItemDetails({ form, set, errors }) {
  return (
    <Card>
      <SectionHeading title="The item" description="Describe it the way you would to a friend." />
      <div className="space-y-5">
        <TextField
          label="Title"
          maxLength={LIMITS.titleMax}
          placeholder="Block-print cotton kurta"
          value={form.title}
          onChange={(event) => set('title', event.target.value)}
          error={errors.title}
        />
        <TextArea
          label="Description"
          rows={5}
          maxLength={LIMITS.descriptionMax}
          hint="Fit, fabric, how often it was worn, and any flaws."
          value={form.description}
          onChange={(event) => set('description', event.target.value)}
          error={errors.description}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            label="Category"
            placeholder="Choose a category"
            options={CATEGORIES}
            value={form.category}
            onChange={(event) => set('category', event.target.value)}
            error={errors.category}
          />
          <SelectField
            label="Condition"
            placeholder="Choose a condition"
            options={CONDITIONS}
            value={form.condition}
            onChange={(event) => set('condition', event.target.value)}
            error={errors.condition}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <TextField
            label="Brand"
            maxLength={LIMITS.brandMax}
            hint="Or “Unbranded”."
            value={form.brand}
            onChange={(event) => set('brand', event.target.value)}
            error={errors.brand}
          />
          <TextField
            label="Size"
            maxLength={LIMITS.sizeMax}
            placeholder="M, 38, UK 7"
            value={form.size}
            onChange={(event) => set('size', event.target.value)}
            error={errors.size}
          />
          <TextField
            label="Colour"
            maxLength={LIMITS.colourMax}
            value={form.colour}
            onChange={(event) => set('colour', event.target.value)}
            error={errors.colour}
          />
        </div>
      </div>
    </Card>
  );
}

function SaleTerms({ form, set, errors }) {
  return (
    <Card>
      <SectionHeading title="Price" />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Selling price"
          prefix="₹"
          inputMode="decimal"
          value={form.price}
          onChange={(event) => set('price', event.target.value)}
          error={errors.price}
        />
        <TextField
          label="Quantity"
          inputMode="numeric"
          hint="Usually 1 for a pre-loved piece."
          value={form.quantity}
          onChange={(event) => set('quantity', event.target.value)}
          error={errors.quantity}
        />
      </div>
    </Card>
  );
}

function RentalPackages({ form, set, errors }) {
  const rows = form.packages;
  const setRow = (key, field, value) =>
    set(
      'packages',
      rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
  const usedDays = new Set(rows.map((row) => row.days.trim()));
  const canAdd = rows.length < LIMITS.packagesMax;

  return (
    <div>
      <p className="text-sm font-medium text-ink">Rental packages</p>
      <p className="mt-0.5 text-sm text-muted">
        Each package is a rental length and its total price. Renters pick one.
      </p>

      <ul className="mt-3 space-y-3">
        {rows.map((row, index) => (
          <li key={row.key} className="flex items-start gap-3">
            <div className="w-28 shrink-0">
              <TextField
                label={index === 0 ? 'Days' : <span className="sr-only">Days</span>}
                inputMode="numeric"
                suffix="days"
                value={row.days}
                onChange={(event) => setRow(row.key, 'days', event.target.value)}
                error={errors[`packages.${index}.days`]}
              />
            </div>
            <div className="min-w-0 flex-1">
              <TextField
                label={index === 0 ? 'Price' : <span className="sr-only">Price</span>}
                prefix="₹"
                inputMode="decimal"
                value={row.price}
                onChange={(event) => setRow(row.key, 'price', event.target.value)}
                error={errors[`packages.${index}.price`]}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className={index === 0 ? 'mt-7' : 'mt-1'}
              disabled={rows.length === 1}
              aria-label={`Remove package ${index + 1}`}
              onClick={() =>
                set(
                  'packages',
                  rows.filter((other) => other.key !== row.key),
                )
              }
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>

      {errors.packages ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errors.packages}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {LIMITS.packagePresetDays
          .filter((days) => !usedDays.has(String(days)))
          .map((days) => (
            <Button
              key={days}
              variant="secondary"
              size="sm"
              disabled={!canAdd}
              onClick={() => set('packages', [...rows, newPackageRow(days)])}
            >
              + {daysLabel(days)}
            </Button>
          ))}
        <Button
          variant="secondary"
          size="sm"
          disabled={!canAdd}
          onClick={() => set('packages', [...rows, newPackageRow()])}
        >
          + Custom length
        </Button>
      </div>
    </div>
  );
}

function RentTerms({ form, set, errors }) {
  return (
    <Card>
      <SectionHeading title="Rental terms" />
      <div className="space-y-6">
        <RentalPackages form={form} set={set} errors={errors} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Security deposit"
            prefix="₹"
            inputMode="decimal"
            hint="Refundable. Collected with the rental fee and refunded after the item is returned and inspected."
            value={form.deposit}
            onChange={(event) => set('deposit', event.target.value)}
            error={errors.deposit}
          />
          <TextField
            label="Late fee per day"
            prefix="₹"
            inputMode="decimal"
            hint="Charged for each day started after a 24-hour grace period. Enter 0 for none."
            value={form.lateFee}
            onChange={(event) => set('lateFee', event.target.value)}
            error={errors.lateFee}
          />
        </div>
      </div>
    </Card>
  );
}

function Fulfilment({ form, set, errors }) {
  return (
    <Card>
      <SectionHeading
        title="Handing it over"
        description="Offer pickup, delivery or both. You arrange delivery yourself."
      />
      <div className="space-y-4">
        <Checkbox
          label="Local pickup"
          description="The other person collects it from you."
          checked={form.pickup}
          onChange={(value) => set('pickup', value)}
        />
        <Checkbox
          label="Home delivery"
          description="You deliver within a distance you choose, for a charge you set."
          checked={form.delivery}
          onChange={(value) => set('delivery', value)}
        />
        {form.delivery ? (
          <div className="grid gap-5 pl-7 sm:grid-cols-2">
            <TextField
              label="Delivery charge"
              prefix="₹"
              inputMode="decimal"
              hint="Enter 0 for free delivery."
              value={form.deliveryCharge}
              onChange={(event) => set('deliveryCharge', event.target.value)}
              error={errors.deliveryCharge}
            />
            <TextField
              label="Delivery radius"
              suffix="km"
              inputMode="numeric"
              hint={`Between ${LIMITS.radiusMinKm} and ${LIMITS.radiusMaxKm} km.`}
              value={form.deliveryRadius}
              onChange={(event) => set('deliveryRadius', event.target.value)}
              error={errors.deliveryRadius}
            />
          </div>
        ) : null}
        {errors.fulfilment ? <Alert tone="error">{errors.fulfilment}</Alert> : null}
      </div>
    </Card>
  );
}

/**
 * The detail sections of the listing form, shared by create and edit.
 * `form` is the text state from lib/listingForm.js; `onChange(field, value)` updates it.
 */
export function ListingFields({ mode, form, onChange, errors }) {
  return (
    <>
      <ItemDetails form={form} set={onChange} errors={errors} />
      {mode === 'SALE' ? (
        <SaleTerms form={form} set={onChange} errors={errors} />
      ) : (
        <RentTerms form={form} set={onChange} errors={errors} />
      )}
      <Fulfilment form={form} set={onChange} errors={errors} />
    </>
  );
}
