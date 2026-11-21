import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/authContext.js';
import { useCart } from '../cart/cartContext.js';
import { AddressForm } from '../components/orders/Addresses.jsx';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  ChoiceCards,
  EmptyState,
  Loading,
  SelectField,
} from '../components/ui/index.js';
import { api } from '../lib/api.js';
import { formatPaise } from '../lib/money.js';
import { addressLines } from '../lib/orders.js';

function ItemRow({ item, onChange, busy }) {
  const { listing } = item;
  const stock = listing.sale?.quantity ?? 0;
  const cover = listing.images[0];
  return (
    <li className="flex gap-3 py-3">
      <Link
        to={`/listings/${listing.id}`}
        className="block size-16 shrink-0 overflow-hidden rounded-field bg-paper"
      >
        {cover ? <img src={cover.url} alt="" className="size-full object-cover" /> : null}
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          to={`/listings/${listing.id}`}
          className="break-words font-medium text-ink underline-offset-4 hover:underline"
        >
          {listing.title}
        </Link>
        <p className="text-sm text-muted">
          {formatPaise(item.unitPricePaise)}
          {item.quantity > 1 ? ` × ${item.quantity}` : ''}
          {item.offerId ? (
            <span className="ml-2 font-medium text-success">
              your offer price (listed {formatPaise(listing.sale.pricePaise)})
            </span>
          ) : null}
        </p>
        {item.problem ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {item.problem}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {stock > 1 ? (
            <label className="text-sm text-muted">
              Qty{' '}
              <select
                className="ml-1 rounded-field border border-line-strong bg-surface px-2 py-1 text-ink"
                value={Math.min(item.quantity, stock)}
                disabled={busy}
                onChange={(event) => onChange('quantity', Number(event.target.value))}
              >
                {Array.from({ length: Math.min(stock, 10) }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onChange('remove')}>
            Remove
          </Button>
        </div>
      </div>
    </li>
  );
}

function SellerGroup({
  group,
  choice,
  onChoose,
  addresses,
  onAddressAdded,
  onItem,
  busy,
  problem,
}) {
  const [adding, setAdding] = useState(false);
  const { user } = useAuth();
  const options = [];
  if (group.options.delivery) {
    options.push({
      value: 'DELIVERY',
      label: 'Home delivery',
      description:
        group.options.delivery.chargePaise > 0
          ? `${formatPaise(group.options.delivery.chargePaise)} delivery charge`
          : 'Free delivery',
    });
  }
  if (group.options.pickup) {
    options.push({
      value: 'PICKUP',
      label: 'Local pickup',
      description: 'Collect it from the seller. No charge.',
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">
          From {group.seller.displayName}
        </h2>
        {group.seller.locality ? (
          <p className="text-sm text-muted">{group.seller.locality}</p>
        ) : null}
      </div>
      <ul className="divide-y divide-line">
        {group.items.map((item) => (
          <ItemRow
            key={item.listing.id}
            item={item}
            busy={busy}
            onChange={(action, value) => onItem(item.listing.id, action, value)}
          />
        ))}
      </ul>

      <div className="mt-4 space-y-4 border-t border-line pt-4">
        {options.length === 0 ? (
          <Alert tone="notice">
            These items cannot all be handed over the same way. Remove one, or buy them separately.
          </Alert>
        ) : (
          <ChoiceCards
            legend="How would you like to get it?"
            options={options}
            value={choice.fulfilment}
            onChange={(fulfilment) => onChoose({ ...choice, fulfilment })}
          />
        )}

        {choice.fulfilment === 'DELIVERY' ? (
          <div className="space-y-3">
            {addresses.length > 0 ? (
              <SelectField
                label="Deliver to"
                placeholder="Choose an address"
                options={addresses.map((address) => ({
                  value: address.id,
                  label: `${address.label}: ${address.line1}, ${address.locality}`,
                }))}
                value={choice.addressId ?? ''}
                onChange={(event) => onChoose({ ...choice, addressId: event.target.value })}
              />
            ) : null}
            {choice.addressId ? (
              <p className="text-sm text-muted">
                {addressLines(addresses.find((a) => a.id === choice.addressId) ?? {})
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
            {adding ? (
              <AddressForm
                defaultName={user.profile.displayName}
                onSaved={(address) => {
                  setAdding(false);
                  onAddressAdded(address);
                  onChoose({ ...choice, addressId: address.id });
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                Add a new address
              </Button>
            )}
          </div>
        ) : null}

        {problem ? (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

export default function CartPage() {
  const { cart, setCart, refresh } = useCart();
  const navigate = useNavigate();
  const [addresses, setAddresses] = useState(null);
  const [choices, setChoices] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [groupProblems, setGroupProblems] = useState({});

  useEffect(() => {
    let cancelled = false;
    refresh();
    api('/me/addresses')
      .then((data) => {
        if (!cancelled) setAddresses(data.items);
      })
      .catch(() => {
        if (!cancelled) setAddresses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  if (!cart || addresses === null) return <Loading label="Loading your cart" />;

  if (cart.itemCount === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Cart</h1>
        <div className="mt-6">
          <EmptyState
            title="Your cart is empty"
            action={<ButtonLink to="/search?mode=SALE">Find something</ButtonLink>}
          >
            Items you add stay here until you check out.
          </EmptyState>
        </div>
      </div>
    );
  }

  const defaultAddress = addresses.find((address) => address.isDefault)?.id;
  // A choice per seller: what the person picked, or a sensible starting point.
  const choiceFor = (group) =>
    choices[group.seller.id] ?? {
      fulfilment: group.options.delivery ? 'DELIVERY' : group.options.pickup ? 'PICKUP' : null,
      addressId: defaultAddress,
    };

  async function changeItem(listingId, action, value) {
    setBusy(true);
    setError(null);
    try {
      const { cart: updated } =
        action === 'remove'
          ? await api(`/cart/items/${listingId}`, { method: 'DELETE' })
          : await api(`/cart/items/${listingId}`, { method: 'PATCH', body: { quantity: value } });
      setCart(updated);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const deliveryTotal = cart.groups.reduce((sum, group) => {
    const choice = choiceFor(group);
    return sum + (choice.fulfilment === 'DELIVERY' ? group.options.delivery.chargePaise : 0);
  }, 0);
  const hasProblem = cart.groups.some(
    (group) => group.items.some((item) => item.problem) || !choiceFor(group).fulfilment,
  );

  async function checkout() {
    setError(null);
    setGroupProblems({});
    const missing = {};
    const groups = cart.groups.map((group) => {
      const choice = choiceFor(group);
      if (choice.fulfilment === 'DELIVERY' && !choice.addressId)
        missing[group.seller.id] = 'Choose a delivery address';
      return {
        sellerId: group.seller.id,
        fulfilment: choice.fulfilment,
        ...(choice.fulfilment === 'DELIVERY' ? { addressId: choice.addressId } : {}),
      };
    });
    if (Object.keys(missing).length > 0) {
      setGroupProblems(missing);
      return;
    }
    setBusy(true);
    try {
      const { checkout: started } = await api('/checkouts', { method: 'POST', body: { groups } });
      navigate(`/checkout/${started.id}`);
    } catch (failure) {
      if (failure.code === 'OUTSIDE_DELIVERY_RADIUS') {
        const ids = new Set(failure.details?.listingIds ?? []);
        const group = cart.groups.find((g) => g.items.some((item) => ids.has(item.listing.id)));
        if (group)
          setGroupProblems({
            [group.seller.id]: `${failure.message}. Choose pickup or another address.`,
          });
      } else {
        setError(failure.message);
      }
      if (failure.code === 'OUT_OF_STOCK' || failure.code === 'ITEM_UNAVAILABLE') await refresh();
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Cart</h1>
      <p className="mt-1 text-sm text-muted">
        Items from different sellers become separate orders, each handed over in its own way.
      </p>

      <div className="mt-6 space-y-5">
        {cart.groups.map((group) => (
          <SellerGroup
            key={group.seller.id}
            group={group}
            choice={choiceFor(group)}
            onChoose={(choice) =>
              setChoices((current) => ({ ...current, [group.seller.id]: choice }))
            }
            addresses={addresses}
            onAddressAdded={(address) => setAddresses((current) => [...current, address])}
            onItem={changeItem}
            busy={busy}
            problem={groupProblems[group.seller.id]}
          />
        ))}

        <Card>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Items</dt>
              <dd className="text-ink">{formatPaise(cart.itemsSubtotalPaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Delivery</dt>
              <dd className="text-ink">{deliveryTotal ? formatPaise(deliveryTotal) : 'None'}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
              <dt className="text-ink">Total</dt>
              <dd className="text-ink">{formatPaise(cart.itemsSubtotalPaise + deliveryTotal)}</dd>
            </div>
          </dl>
          {error ? (
            <Alert tone="error" className="mt-4">
              {error}
              {error.toLowerCase().includes('verify') ? (
                <>
                  {' '}
                  <Link to="/verify" className="font-medium underline">
                    Verify now
                  </Link>
                </>
              ) : null}
            </Alert>
          ) : null}
          <Button block className="mt-4" loading={busy} disabled={hasProblem} onClick={checkout}>
            Continue to payment
          </Button>
          <p className="mt-2 text-center text-xs text-muted">
            The items are held for you for 15 minutes while you pay.
          </p>
        </Card>
      </div>
    </div>
  );
}
