import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../auth/authContext.js';
import { useCart } from '../cart/cartContext.js';
import { Alert, Button, ButtonLink, Card, Loading } from '../components/ui/index.js';
import { APP_NAME } from '../config/app.js';
import { api } from '../lib/api.js';
import { formatPaise } from '../lib/money.js';
import { loadRazorpay } from '../lib/razorpay.js';

/** Seconds left until `iso`, counting down once a second. */
function useSecondsLeft(iso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return iso ? Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000)) : 0;
}

function Summary({ checkout }) {
  return (
    <Card>
      <ul className="space-y-4">
        {checkout.groups.map((group) => (
          <li key={group.sellerId}>
            <p className="text-sm font-medium text-ink">
              {group.fulfilment === 'DELIVERY' ? 'Home delivery' : 'Local pickup'}
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {group.items.map((item) => (
                <li key={item.listingId} className="flex justify-between gap-3">
                  <span className="min-w-0 break-words text-muted">
                    {item.title}
                    {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                  </span>
                  <span className="shrink-0 text-ink">
                    {formatPaise(item.unitPricePaise * item.quantity)}
                  </span>
                </li>
              ))}
              {group.deliveryChargePaise > 0 ? (
                <li className="flex justify-between gap-3">
                  <span className="text-muted">Delivery</span>
                  <span className="text-ink">{formatPaise(group.deliveryChargePaise)}</span>
                </li>
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex justify-between border-t border-line pt-3 text-base font-semibold text-ink">
        <span>Total</span>
        <span>{formatPaise(checkout.totalPaise)}</span>
      </p>
    </Card>
  );
}

export default function CheckoutPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { refresh: refreshCart } = useCart();
  const [result, setResult] = useState({ id: null });
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState(null);
  const checkout = result.id === id ? result.checkout : null;
  const secondsLeft = useSecondsLeft(checkout?.status === 'OPEN' ? checkout.expiresAt : null);

  useEffect(() => {
    let cancelled = false;
    api(`/checkouts/${encodeURIComponent(id)}`)
      .then((data) => {
        if (!cancelled) setResult({ id, checkout: data.checkout });
      })
      .catch((failure) => {
        if (!cancelled) setResult({ id, error: failure });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const show = (data) => {
    setResult({ id, checkout: data.checkout });
    if (data.checkout.status === 'PAID') refreshCart();
  };

  async function simulate(outcome) {
    setPaying(true);
    setError(null);
    try {
      const data = await api(`/checkouts/${id}/simulate-payment`, {
        method: 'POST',
        body: { outcome },
      });
      show(data);
      if (data.checkout.status !== 'PAID')
        setError('The payment did not go through. You can try again.');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPaying(false);
    }
  }

  async function payWithRazorpay() {
    setPaying(true);
    setError(null);
    try {
      const Razorpay = await loadRazorpay();
      const { payment } = checkout;
      const window = new Razorpay({
        key: payment.keyId,
        amount: payment.amountPaise,
        currency: payment.currency,
        order_id: payment.gatewayOrderId,
        name: APP_NAME,
        description: 'Pre-loved fashion order',
        prefill: { name: user.profile.displayName, email: user.email, contact: user.phone },
        handler: async (response) => {
          try {
            // The server checks the signature and asks the gateway for the amount.
            show(
              await api(`/checkouts/${id}/verify`, {
                method: 'POST',
                body: {
                  gatewayOrderId: response.razorpay_order_id,
                  gatewayPaymentId: response.razorpay_payment_id,
                  signature: response.razorpay_signature,
                },
              }),
            );
          } catch (failure) {
            setError(failure.message);
          } finally {
            setPaying(false);
          }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      window.on('payment.failed', () =>
        setError('The payment did not go through. You can try again.'),
      );
      window.open();
    } catch (failure) {
      setError(failure.message);
      setPaying(false);
    }
  }

  if (result.id !== id) return <Loading label="Loading checkout" />;
  if (result.error) {
    return (
      <div className="mx-auto max-w-md">
        <Alert tone="error">{result.error.message}</Alert>
        <ButtonLink to="/cart" variant="secondary" className="mt-5">
          Back to cart
        </ButtonLink>
      </div>
    );
  }

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
        {checkout.status === 'PAID' ? 'Thank you!' : 'Payment'}
      </h1>

      <div className="mt-6 space-y-5">
        {checkout.status === 'PAID' ? (
          <Alert tone="success" title="Payment received">
            <p>
              Your{' '}
              {checkout.orderIds.length === 1
                ? 'order is'
                : `${checkout.orderIds.length} orders are`}{' '}
              confirmed. We have emailed you the details.
            </p>
            <ButtonLink to="/orders" size="sm" className="mt-3">
              See my orders
            </ButtonLink>
          </Alert>
        ) : checkout.status === 'EXPIRED' || secondsLeft === 0 ? (
          <Alert tone="notice" title="This checkout has ended">
            <p>
              The 15 minutes to pay ran out, so the items were released. They may still be
              available.
            </p>
            <ButtonLink to="/cart" size="sm" className="mt-3">
              Back to cart
            </ButtonLink>
          </Alert>
        ) : (
          <Alert tone="info">
            Items held for you for{' '}
            <span className="font-semibold" aria-live="off">
              {minutes}:{seconds}
            </span>
            .
          </Alert>
        )}

        <Summary checkout={checkout} />

        {checkout.status === 'OPEN' && secondsLeft > 0 ? (
          <Card>
            {error ? (
              <Alert tone="error" className="mb-4">
                {error}
              </Alert>
            ) : null}
            {checkout.payment?.gateway === 'razorpay' ? (
              <>
                <Button block loading={paying} onClick={payWithRazorpay}>
                  Pay {formatPaise(checkout.totalPaise)}
                </Button>
                <p className="mt-2 text-center text-xs text-muted">
                  Test mode: no real money is taken. Use Razorpay’s test UPI or card details.
                </p>
              </>
            ) : checkout.payment?.gateway === 'simulated' ? (
              <>
                <p className="mb-3 text-sm text-muted">
                  Payments are not connected yet, so this is a simulation. No money moves.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button loading={paying} onClick={() => simulate('success')}>
                    Pay {formatPaise(checkout.totalPaise)} (test simulation)
                  </Button>
                  <Button variant="secondary" disabled={paying} onClick={() => simulate('failure')}>
                    Simulate a failed payment
                  </Button>
                </div>
              </>
            ) : (
              <Alert tone="error">Payments are not available right now.</Alert>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
