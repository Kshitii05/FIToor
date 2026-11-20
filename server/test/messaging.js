import http from 'node:http';
import { io as connect } from 'socket.io-client';
import request from 'supertest';
import { attachRealtime } from '../src/modules/messaging/realtime.js';
import { PNG } from './listings.js';

const API = '/api/v1';

export const startChat = (ctx, account, about) =>
  request(ctx.app).post(`${API}/conversations`).set(account.bearer).send(about);

export const sendMessage = (ctx, account, conversationId, body) =>
  request(ctx.app)
    .post(`${API}/conversations/${conversationId}/messages`)
    .set(account.bearer)
    .send(body);

export function sendPhotos(ctx, account, conversationId, data = {}, photos = 1) {
  const req = request(ctx.app)
    .post(`${API}/conversations/${conversationId}/messages`)
    .set(account.bearer)
    .field('data', JSON.stringify(data));
  for (let i = 0; i < photos; i += 1) req.attach('photos', PNG, `photo-${i}.png`);
  return req;
}

export const readMessages = (ctx, account, conversationId, query = '') =>
  request(ctx.app)
    .get(`${API}/conversations/${conversationId}/messages${query}`)
    .set(account.bearer);

export const makeOffer = (ctx, account, body) =>
  request(ctx.app).post(`${API}/offers`).set(account.bearer).send(body);

export const offerAction = (ctx, account, offerId, action, body = {}) =>
  request(ctx.app).post(`${API}/offers/${offerId}/${action}`).set(account.bearer).send(body);

export const block = (ctx, account, userId) =>
  request(ctx.app).post(`${API}/blocks`).set(account.bearer).send({ userId });

/** Runs the app on a free port with live chat attached. Returns its URL and a closer. */
export async function listen(ctx) {
  const server = http.createServer(ctx.app);
  attachRealtime(server, ctx.app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  return {
    url,
    /** A live connection; resolves once connected, rejects if refused. */
    connect(token) {
      const socket = connect(url, {
        auth: token === undefined ? {} : { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(socket);
      return new Promise((resolve, reject) => {
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', (error) => reject(error));
      });
    },
    async close() {
      for (const socket of sockets) socket.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Waits for the next `event` on a socket, failing after `ms`. */
export function nextEvent(socket, event, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No ${event} within ${ms} ms`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Emits with an acknowledgement and resolves with the server's answer. */
export const ask = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));
