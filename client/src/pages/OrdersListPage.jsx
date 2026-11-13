import { useState } from 'react';
import { OrderRow } from '../components/orders/OrderParts.jsx';
import {
  Alert,
  ButtonLink,
  EmptyState,
  FilterTabs,
  Loading,
  Pagination,
} from '../components/ui/index.js';
import { ORDER_FILTERS } from '../lib/orders.js';
import { useOrderList } from '../lib/useOrders.js';

/** "My orders" (side="buyer") or "My sales" (side="seller"). */
export default function OrdersListPage({ side }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { loading, data, error } = useOrderList({ side, status, page });
  const buyer = side === 'buyer';

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
        {buyer ? 'My orders' : 'My sales'}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {buyer ? 'Things you have bought.' : 'Orders for the items you sell.'}
      </p>
      <div className="mt-5">
        <FilterTabs
          label="Filter by status"
          options={ORDER_FILTERS}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </div>
      <div className="mt-5" aria-busy={loading}>
        {error && !loading ? (
          <Alert tone="error">{error.message}</Alert>
        ) : !data ? (
          <Loading label="Loading" />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={status ? 'Nothing here' : buyer ? 'No orders yet' : 'No sales yet'}
            action={
              status ? null : buyer ? (
                <ButtonLink to="/search?mode=SALE">Find something</ButtonLink>
              ) : (
                <ButtonLink to="/listings/new">List an item</ButtonLink>
              )
            }
          />
        ) : (
          <>
            <ul className={`space-y-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {data.items.map((order) => (
                <OrderRow key={order.id} order={order} side={side} />
              ))}
            </ul>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              disabled={loading}
              onChange={setPage}
            />
          </>
        )}
      </div>
    </div>
  );
}
