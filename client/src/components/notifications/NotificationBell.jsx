import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { useChat } from '../../chat/chatContext.js';
import { api } from '../../lib/api.js';
import { ago, CATEGORY } from '../../lib/notifications.js';
import { useOpenNotification } from '../../lib/useNotifications.js';

const BELL_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
    <path
      d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 3.5a2 2 0 0 0 4 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** One notification in a list: opening it marks it read and goes to its page. */
export function NotificationItem({ notification, onOpen, compact = false }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={`flex w-full gap-3 text-left transition-colors hover:bg-accent-soft ${
        compact ? 'px-4 py-3' : 'rounded-card border border-line bg-surface p-4 shadow-card'
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.read ? 'bg-transparent' : 'bg-accent'}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span
            className={`truncate text-sm ${notification.read ? 'text-ink' : 'font-semibold text-ink'}`}
          >
            {notification.title}
          </span>
          <span className="shrink-0 text-xs text-muted">{ago(notification.createdAt)}</span>
        </span>
        <span className={`mt-0.5 block text-sm text-muted ${compact ? 'line-clamp-2' : ''}`}>
          {notification.body}
        </span>
        {!compact ? (
          <span className="mt-1 block text-xs text-muted">
            {CATEGORY[notification.category]?.label}
            {notification.read ? '' : ' · unread'}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** The bell in the header: live unread count and the latest notifications. */
export function NotificationBell() {
  const { user } = useAuth();
  const { socket } = useChat();
  const [count, setCount] = useState({ userId: null, value: 0 });
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const menuId = useId();
  const wrapper = useRef(null);
  const userId = user?.id ?? null;
  const unread = count.userId === userId ? count.value : 0;

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    api('/notifications/unread-count')
      .then((data) => !cancelled && setCount({ userId, value: data.count }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // New notifications arrive live with the new count.
  useEffect(() => {
    if (!socket) return undefined;
    const arrived = ({ notification, unreadCount }) => {
      setCount({ userId, value: unreadCount });
      setItems((current) => (current ? [notification, ...current].slice(0, 8) : current));
    };
    socket.on('notification:new', arrived);
    return () => socket.off('notification:new', arrived);
  }, [socket, userId]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    api('/notifications?pageSize=8')
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setCount({ userId, value: data.unreadCount });
      })
      .catch(() => !cancelled && setItems([]));
    const close = (event) => {
      if (
        event.type === 'keydown' ? event.key === 'Escape' : !wrapper.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      cancelled = true;
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open, userId]);

  const markLocal = (id) => {
    setItems((current) => current?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? current);
    setCount((current) => ({ userId, value: Math.max(0, current.value - 1) }));
  };
  const openNotification = useOpenNotification(markLocal);

  async function readAll() {
    await api('/notifications/read-all', { method: 'POST' });
    setItems((current) => current?.map((n) => ({ ...n, read: true })) ?? current);
    setCount({ userId, value: 0 });
  }

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        onClick={() => setOpen((value) => !value)}
        className="relative flex min-h-9 items-center rounded-field px-2 text-ink hover:bg-accent-soft"
      >
        {BELL_ICON}
        {unread ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold leading-5 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={menuId}
          className="fixed inset-x-4 top-16 z-30 overflow-hidden rounded-card border border-line bg-surface shadow-card sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[22rem]"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            {unread ? (
              <button
                type="button"
                onClick={readAll}
                className="text-xs font-medium text-accent hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          {items === null ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Nothing yet.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((notification) => (
                <li key={notification.id}>
                  <NotificationItem
                    notification={notification}
                    compact
                    onOpen={(n) => {
                      setOpen(false);
                      openNotification(n);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-line px-4 py-2 text-center text-sm font-medium text-accent hover:bg-accent-soft"
          >
            See all
          </Link>
        </div>
      ) : null}
    </div>
  );
}
