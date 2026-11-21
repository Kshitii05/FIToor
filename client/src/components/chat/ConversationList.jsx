import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { useChat } from '../../chat/chatContext.js';
import { api } from '../../lib/api.js';
import { messageTime } from '../../lib/chat.js';
import { formatPaise } from '../../lib/money.js';
import { Alert, EmptyState, Loading } from '../ui/index.js';

function preview(message, me) {
  if (!message) return 'No messages yet';
  const who = message.senderId === me ? 'You: ' : '';
  if (message.kind === 'OFFER' && message.offer)
    return `${who}Offer of ${formatPaise(message.offer.unitPricePaise)}`;
  if (message.kind === 'PHOTO' && !message.body) return `${who}Photo`;
  if (message.listing && !message.body) return `${who}${message.listing.title}`;
  return `${who}${message.body ?? ''}`;
}

/** The signed-in person's chats, newest first, kept fresh by live events. */
export function ConversationList({ activeId }) {
  const { user } = useAuth();
  const { socket } = useChat();
  const [result, setResult] = useState({ loaded: false });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api('/conversations?pageSize=50')
      .then((data) => !cancelled && setResult({ loaded: true, items: data.items }))
      .catch((error) => !cancelled && setResult({ loaded: true, error }));
    return () => {
      cancelled = true;
    };
  }, [version, activeId]);

  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => setVersion((v) => v + 1);
    socket.on('message:new', refresh);
    return () => socket.off('message:new', refresh);
  }, [socket]);

  if (!result.loaded) return <Loading label="Loading chats" />;
  if (result.error) return <Alert tone="error">{result.error.message}</Alert>;
  if (result.items.length === 0) {
    return (
      <EmptyState title="No chats yet">
        Message a seller from any listing, or from an order or rental.
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {result.items.map((conversation) => {
        const active = conversation.id === activeId;
        const unread = !active && conversation.unreadCount > 0;
        return (
          <li key={conversation.id}>
            <Link
              to={`/messages/${conversation.id}`}
              aria-current={active ? 'page' : undefined}
              className={`flex items-start gap-3 px-4 py-3 transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-paper'}`}
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display font-semibold text-accent-strong"
              >
                {conversation.other.displayName[0]?.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate ${unread ? 'font-semibold' : 'font-medium'} text-ink`}>
                    {conversation.other.displayName}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {messageTime(conversation.lastMessageAt)}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${unread ? 'text-ink' : 'text-muted'}`}>
                    {preview(conversation.lastMessage, user.id)}
                  </span>
                  {unread ? (
                    <span className="flex min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold leading-5 text-white">
                      {conversation.unreadCount}
                    </span>
                  ) : null}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
