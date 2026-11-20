import { Server } from 'socket.io';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticateToken } from '../../lib/auth.js';
import { loadOwnConversation, markReceipt } from './messaging.service.js';

// Live chat over Socket.IO (SPEC Module 8). Every connection must carry a valid
// access token, checked like an API request. Each person joins a private room of
// their own; the server sends new messages, receipts and offer changes there.
// Joining a conversation's room (for "typing…") is allowed only after the server
// confirms the person is one of its two people. One server process in the MVP (I78).

const userRoom = (userId) => `user:${userId}`;
const conversationRoom = (id) => `conversation:${id}`;

const joinSchema = z.object({ conversationId: z.uuid() });
const receiptSchema = z.object({
  conversationId: z.uuid(),
  upTo: z.number().int().min(0),
});

/**
 * The live-chat hub kept in the app's dependencies. Until `attach` is called (by the
 * server, or a test), sending does nothing, so services work the same everywhere.
 */
export function createRealtimeHub() {
  let io = null;
  return {
    get io() {
      return io;
    },
    setServer(server) {
      io = server;
    },
    /** Sends `event` to every live connection of these people. */
    toUsers(userIds, event, payload) {
      if (!io) return;
      io.to([...new Set(userIds)].map(userRoom)).emit(event, payload);
    },
  };
}

/** Starts Socket.IO on an HTTP server for the given Express app. */
export function attachRealtime(httpServer, app) {
  const deps = app.locals.deps;
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    try {
      const auth = await authenticateToken(deps, socket.handshake.auth?.token);
      if (!auth) return next(new Error('UNAUTHORIZED'));
      socket.data.auth = auth;
      return next();
    } catch (error) {
      deps.logger.error(error);
      return next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.data.auth.userId;
    socket.join(userRoom(me));

    // Each handler answers through the acknowledgement: { ok } or { ok: false, error }.
    const handle = (event, schema, work) =>
      socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        const parsed = schema.safeParse(payload);
        if (!parsed.success) return reply({ ok: false, error: 'BAD_REQUEST' });
        try {
          const conversation = await loadOwnConversation(deps.db, parsed.data.conversationId, me);
          await work(conversation, parsed.data);
          return reply({ ok: true });
        } catch (error) {
          if (error?.status === 404) return reply({ ok: false, error: 'NOT_FOUND' });
          deps.logger.error(error);
          return reply({ ok: false, error: 'SERVER_ERROR' });
        }
      });

    handle('conversation:join', joinSchema, (conversation) =>
      socket.join(conversationRoom(conversation.id)),
    );
    handle('conversation:leave', joinSchema, (conversation) =>
      socket.leave(conversationRoom(conversation.id)),
    );
    handle('message:delivered', receiptSchema, (conversation, { upTo }) =>
      markReceipt(deps, me, conversation, 'delivered', upTo),
    );
    handle('message:read', receiptSchema, (conversation, { upTo }) =>
      markReceipt(deps, me, conversation, 'read', upTo),
    );
    handle('typing', joinSchema, (conversation) => {
      // Only someone already in the room may tell it they are typing.
      if (socket.rooms.has(conversationRoom(conversation.id))) {
        socket.to(conversationRoom(conversation.id)).emit('typing', {
          conversationId: conversation.id,
          userId: me,
        });
      }
    });
  });

  deps.realtime.setServer(io);
  return io;
}
