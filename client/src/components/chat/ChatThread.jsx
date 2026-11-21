import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/authContext.js';
import { useChat } from '../../chat/chatContext.js';
import { api } from '../../lib/api.js';
import {
  fullTime,
  MESSAGE_MAX_LENGTH,
  MESSAGE_PHOTOS_MAX,
  mergeMessages,
  messageTime,
  withOffer,
} from '../../lib/chat.js';
import { photoProblem } from '../../lib/listingForm.js';
import { formatPaise } from '../../lib/money.js';
import { Alert, Button, Loading } from '../ui/index.js';
import { OfferCard } from './OfferCard.jsx';

function Ticks({ message, conversation }) {
  const read = message.seq <= conversation.otherReadUpTo;
  const delivered = message.seq <= conversation.otherDeliveredUpTo;
  const label = read ? 'Read' : delivered ? 'Delivered' : 'Sent';
  return (
    <span aria-label={label} title={label} className={read ? 'text-accent' : 'text-muted'}>
      {delivered ? '✓✓' : '✓'}
    </span>
  );
}

function ListingLink({ listing }) {
  return (
    <Link
      to={`/listings/${listing.id}`}
      className="mt-1 flex items-center gap-3 rounded-field border border-line bg-surface p-2 text-ink hover:bg-paper"
    >
      {listing.imageUrl ? (
        <img
          src={listing.imageUrl}
          alt=""
          className="size-12 shrink-0 rounded-field object-cover"
        />
      ) : null}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{listing.title}</span>
        <span className="block text-xs text-muted">
          {listing.mode === 'RENT' ? 'For rent from ' : ''}
          {formatPaise(listing.pricePaise)}
        </span>
      </span>
    </Link>
  );
}

function Bubble({ message, me, conversation, onOffer }) {
  if (message.kind === 'SYSTEM') {
    return (
      <li className="flex justify-center">
        <p className="max-w-md rounded-full bg-paper px-3 py-1 text-center text-xs text-muted">
          {message.body} · {messageTime(message.createdAt)}
        </p>
      </li>
    );
  }
  const mine = message.senderId === me;
  return (
    <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {message.offer ? (
          <OfferCard offer={message.offer} me={me} onChange={onOffer} />
        ) : (
          <div
            className={`rounded-card px-3 py-2 text-sm ${
              mine ? 'bg-accent text-white' : 'border border-line bg-surface text-ink'
            }`}
          >
            {message.attachments.length ? (
              <div className="mb-1 grid grid-cols-2 gap-1">
                {message.attachments.map((photo) => (
                  <a key={photo.url} href={photo.url} target="_blank" rel="noreferrer">
                    <img
                      src={photo.url}
                      alt="Photo"
                      className="aspect-square w-32 rounded-field object-cover"
                    />
                  </a>
                ))}
              </div>
            ) : null}
            {message.body ? (
              <p className="whitespace-pre-line break-words">{message.body}</p>
            ) : null}
            {message.listing ? <ListingLink listing={message.listing} /> : null}
          </div>
        )}
        <p className="mt-0.5 flex gap-1 text-xs text-muted" title={fullTime(message.createdAt)}>
          {messageTime(message.createdAt)}
          {mine ? <Ticks message={message} conversation={conversation} /> : null}
        </p>
      </div>
    </li>
  );
}

function Composer({ conversationId, disabled, onSent }) {
  const { socket } = useChat();
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const lastTyping = useRef(0);

  function typing(value) {
    setText(value);
    const now = Date.now();
    if (socket && now - lastTyping.current > 2000) {
      lastTyping.current = now;
      socket.emit('typing', { conversationId });
    }
  }

  function choose(event) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = '';
    setError(chosen.map(photoProblem).find(Boolean) ?? null);
    setFiles((current) =>
      [...current, ...chosen.filter((f) => !photoProblem(f))].slice(0, MESSAGE_PHOTOS_MAX),
    );
  }

  async function send() {
    if (!text.trim() && files.length === 0) return;
    setSending(true);
    setError(null);
    try {
      let body = { body: text.trim() || undefined };
      if (files.length) {
        const form = new FormData();
        form.append('data', JSON.stringify(body));
        files.forEach((file) => form.append('photos', file));
        body = form;
      }
      const { message } = await api(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body,
      });
      setText('');
      setFiles([]);
      onSent(message);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-line p-3">
      {error ? (
        <p role="alert" className="mb-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {files.length ? (
        <p className="mb-2 text-xs text-muted">
          {files.length} photo{files.length > 1 ? 's' : ''}: {files.map((f) => f.name).join(', ')}{' '}
          <button type="button" className="text-accent underline" onClick={() => setFiles([])}>
            remove
          </button>
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={choose}
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label="Add photos"
          disabled={disabled || files.length >= MESSAGE_PHOTOS_MAX}
          onClick={() => input.current?.click()}
        >
          📷
        </Button>
        <label className="sr-only" htmlFor={`compose-${conversationId}`}>
          Message
        </label>
        <textarea
          id={`compose-${conversationId}`}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          disabled={disabled}
          placeholder={disabled ? 'You cannot send messages here' : 'Write a message'}
          value={text}
          onChange={(event) => typing(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          className="max-h-32 min-h-10 flex-1 resize-y rounded-field border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-accent disabled:opacity-60"
        />
        <Button
          loading={sending}
          disabled={disabled || (!text.trim() && !files.length)}
          onClick={send}
        >
          Send
        </Button>
      </div>
    </div>
  );
}

function BlockToggle({ conversation, onChange }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const blocked = conversation.blocked.byMe;

  async function toggle() {
    setBusy(true);
    try {
      if (blocked) {
        await api(`/blocks/${conversation.other.id}`, { method: 'DELETE' });
      } else {
        await api('/blocks', { method: 'POST', body: { userId: conversation.other.id } });
      }
      onChange();
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (!blocked && !confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Block…
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!blocked ? (
        <span className="text-xs text-muted">Block {conversation.other.displayName}?</span>
      ) : null}
      <Button variant={blocked ? 'secondary' : 'danger'} size="sm" loading={busy} onClick={toggle}>
        {blocked ? 'Unblock' : 'Yes, block'}
      </Button>
      {!blocked ? (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      ) : null}
    </div>
  );
}

/** One conversation: history, live updates, ticks, offers and the box to write in. */
export function ChatThread({ conversationId, back }) {
  const { user } = useAuth();
  const { socket, refreshUnread } = useChat();
  const me = user.id;
  const [state, setState] = useState({ id: null });
  const [olderBusy, setOlderBusy] = useState(false);
  const [typingUntil, setTypingUntil] = useState(0);
  const bottom = useRef(null);
  const ready = state.id === conversationId && state.conversation;
  const { conversation, messages = [], hasMore, error } = state.id === conversationId ? state : {};

  const reloadConversation = useCallback(async () => {
    const data = await api(`/conversations/${conversationId}`);
    setState((s) => (s.id === conversationId ? { ...s, conversation: data.conversation } : s));
  }, [conversationId]);

  // Load the conversation and its latest messages.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api(`/conversations/${conversationId}`),
      api(`/conversations/${conversationId}/messages?limit=30`),
    ])
      .then(([c, m]) => {
        if (!cancelled) {
          setState({
            id: conversationId,
            conversation: c.conversation,
            messages: m.items,
            hasMore: m.hasMore,
          });
        }
      })
      .catch((failure) => !cancelled && setState({ id: conversationId, error: failure }));
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Mark what is shown as read.
  const lastSeq = messages.at(-1)?.seq ?? 0;
  const myReadUpTo = conversation?.myReadUpTo ?? 0;
  useEffect(() => {
    if (!ready || lastSeq <= myReadUpTo) return;
    api(`/conversations/${conversationId}/read`, { method: 'POST', body: { upTo: lastSeq } })
      .then((data) => {
        setState((s) => (s.id === conversationId ? { ...s, conversation: data.conversation } : s));
        refreshUnread();
      })
      .catch(() => {});
  }, [ready, lastSeq, myReadUpTo, conversationId, refreshUnread]);

  // Live updates for this conversation.
  useEffect(() => {
    if (!socket || !ready) return undefined;
    const join = () => socket.emit('conversation:join', { conversationId }, () => {});
    join();
    socket.on('connect', join);
    const onMessage = ({ conversationId: id, message }) => {
      if (id !== conversationId) return;
      setState((s) => ({ ...s, messages: mergeMessages(s.messages, [message]) }));
      if (message.senderId !== me) {
        socket.emit('message:delivered', { conversationId, upTo: message.seq }, () => {});
        setTypingUntil(0);
      }
    };
    const onReceipt = ({ conversationId: id, userId, deliveredUpTo, readUpTo }) => {
      if (id !== conversationId || userId === me) return;
      setState((s) => ({
        ...s,
        conversation: {
          ...s.conversation,
          otherDeliveredUpTo: deliveredUpTo,
          otherReadUpTo: readUpTo,
        },
      }));
    };
    const onOffer = ({ conversationId: id, offer }) => {
      if (id === conversationId)
        setState((s) => ({ ...s, messages: withOffer(s.messages, offer) }));
    };
    const onTyping = ({ conversationId: id, userId }) => {
      if (id === conversationId && userId !== me) setTypingUntil(Date.now() + 4000);
    };
    socket.on('message:new', onMessage);
    socket.on('receipt', onReceipt);
    socket.on('offer:updated', onOffer);
    socket.on('typing', onTyping);
    return () => {
      socket.emit('conversation:leave', { conversationId }, () => {});
      socket.off('connect', join);
      socket.off('message:new', onMessage);
      socket.off('receipt', onReceipt);
      socket.off('offer:updated', onOffer);
      socket.off('typing', onTyping);
    };
  }, [socket, ready, conversationId, me]);

  // "typing…" fades on its own.
  useEffect(() => {
    if (!typingUntil) return undefined;
    const timer = setTimeout(() => setTypingUntil(0), Math.max(0, typingUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [typingUntil]);

  // Keep the newest message in view.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [lastSeq]);

  async function loadOlder() {
    setOlderBusy(true);
    try {
      const data = await api(
        `/conversations/${conversationId}/messages?limit=30&before=${messages[0].seq}`,
      );
      setState((s) => ({
        ...s,
        messages: mergeMessages(s.messages, data.items),
        hasMore: data.hasMore,
      }));
    } finally {
      setOlderBusy(false);
    }
  }

  if (error) {
    return (
      <Alert tone={error.status === 404 ? 'notice' : 'error'}>
        {error.status === 404
          ? 'This conversation does not exist, or is not yours.'
          : error.message}
      </Alert>
    );
  }
  if (!ready) return <Loading label="Loading conversation" />;

  const blocked = conversation.blocked.byMe || conversation.blocked.byThem;
  return (
    <div className="flex h-[70dvh] min-h-96 flex-col rounded-card border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {back}
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{conversation.other.displayName}</p>
            <p className="text-xs text-muted" aria-live="polite">
              {typingUntil
                ? 'typing…'
                : 'Phone numbers and emails stay hidden until you have a paid order or rental together.'}
            </p>
          </div>
        </div>
        {!conversation.other.deleted ? (
          <BlockToggle conversation={conversation} onChange={reloadConversation} />
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {hasMore ? (
          <div className="mb-3 text-center">
            <Button variant="ghost" size="sm" loading={olderBusy} onClick={loadOlder}>
              Show older messages
            </Button>
          </div>
        ) : null}
        {messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-muted">Say hello. Messages appear here.</p>
        ) : null}
        <ul className="space-y-3">
          {messages.map((message) => (
            <Bubble
              key={message.id}
              message={message}
              me={me}
              conversation={conversation}
              onOffer={(offer) =>
                setState((s) => ({ ...s, messages: withOffer(s.messages, offer) }))
              }
            />
          ))}
        </ul>
        <div ref={bottom} />
      </div>

      {blocked ? (
        <p className="border-t border-line px-4 py-3 text-sm text-muted">
          {conversation.blocked.byMe
            ? 'You blocked this person. Unblock them to send messages.'
            : 'You cannot send messages to this person.'}
        </p>
      ) : (
        <Composer
          conversationId={conversationId}
          disabled={conversation.other.deleted}
          onSent={(message) =>
            setState((s) => ({ ...s, messages: mergeMessages(s.messages, [message]) }))
          }
        />
      )}
    </div>
  );
}
