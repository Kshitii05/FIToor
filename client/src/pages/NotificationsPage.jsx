import { useEffect, useState } from 'react';
import { NotificationItem } from '../components/notifications/NotificationBell.jsx';
import {
  Alert,
  Button,
  EmptyState,
  FilterTabs,
  Loading,
  Pagination,
} from '../components/ui/index.js';
import { useChat } from '../chat/chatContext.js';
import { api } from '../lib/api.js';
import { useOpenNotification } from '../lib/useNotifications.js';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'unread', label: 'Unread' },
];

/** The notification centre: history, read and unread, newest first. */
export default function NotificationsPage() {
  const { socket } = useChat();
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const query = new URLSearchParams({ page: String(page) });
  if (filter) query.set('unread', 'true');
  const key = `/notifications?${query}&v=${version}`;
  const [result, setResult] = useState({ key: null });

  useEffect(() => {
    let cancelled = false;
    api(key.replace(/&v=\d+$/, ''))
      .then((data) => !cancelled && setResult({ key, data }))
      .catch((error) => !cancelled && setResult({ key, error }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  // A new notification while this page is open shows up at the top.
  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => setVersion((v) => v + 1);
    socket.on('notification:new', refresh);
    return () => socket.off('notification:new', refresh);
  }, [socket]);

  const markLocal = (id) =>
    setResult((current) =>
      current.data
        ? {
            ...current,
            data: {
              ...current.data,
              unreadCount: Math.max(0, current.data.unreadCount - 1),
              items: current.data.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
            },
          }
        : current,
    );
  const open = useOpenNotification(markLocal);

  async function readAll() {
    await api('/notifications/read-all', { method: 'POST' });
    setVersion((v) => v + 1);
  }

  const loading = result.key !== key;
  const { data, error } = result;
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-muted">
            Updates about your orders, rentals, payments and disputes, and anything else you chose
            to hear about.
          </p>
        </div>
        {data?.unreadCount ? (
          <Button variant="secondary" size="sm" onClick={readAll}>
            Mark all read
          </Button>
        ) : null}
      </div>
      <div className="mt-5">
        <FilterTabs
          label="Show"
          options={FILTERS}
          value={filter}
          onChange={(value) => {
            setFilter(value);
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
          <EmptyState title={filter ? 'All read' : 'Nothing yet'}>
            {filter
              ? 'You have read everything.'
              : 'Notifications about your activity appear here.'}
          </EmptyState>
        ) : (
          <>
            <ul className={`space-y-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {data.items.map((notification) => (
                <li key={notification.id}>
                  <NotificationItem notification={notification} onOpen={open} />
                </li>
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
