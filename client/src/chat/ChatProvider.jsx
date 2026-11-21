import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../auth/authContext.js';
import { api, getAccessToken, refreshSession } from '../lib/api.js';
import { ChatContext } from './chatContext.js';

/**
 * Opens the live chat connection while someone is signed in and keeps the unread
 * count for the header. The connection sends the in-memory access token; when it
 * has expired, the session is renewed and the connection tried again once.
 */
export function ChatProvider({ children }) {
  const { status, user } = useAuth();
  const userId = status === 'signedIn' ? user.id : null;
  const [socket, setSocket] = useState(null);
  const [unread, setUnread] = useState({ userId: null, count: 0 });

  const refreshUnread = useCallback(async () => {
    if (!userId) return;
    try {
      const { count } = await api('/conversations/unread-count');
      setUnread({ userId, count });
    } catch {
      // The count is a convenience; the messages page shows any real problem.
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    const connection = io({
      // Read on every (re)connection, so a renewed token is used.
      auth: (send) => send({ token: getAccessToken() }),
      transports: ['websocket'],
    });
    let retried = false;
    connection.on('connect_error', async (error) => {
      if (error.message !== 'UNAUTHORIZED' || retried) return;
      retried = true;
      if (await refreshSession()) connection.connect();
    });
    // Shared with the pages once connected (and again after any reconnection).
    connection.on('connect', () => {
      retried = false;
      setSocket({ userId, connection });
      refreshUnread();
    });
    const recount = () => refreshUnread();
    connection.on('message:new', recount);
    connection.on('receipt', recount);
    return () => connection.close();
  }, [userId, refreshUnread]);

  const value = useMemo(
    () => ({
      // Keyed by the user, so a connection is never shown to someone else after sign-out.
      socket: socket?.userId === userId ? socket.connection : null,
      unread: unread.userId === userId ? unread.count : 0,
      refreshUnread,
    }),
    [socket, unread, userId, refreshUnread],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
