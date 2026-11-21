import { API_BASE_URL } from '../config/app.js';

/** An error response from the API, or a failure to reach it (`status` 0). */
export class ApiError extends Error {
  constructor(status, { code, message, details } = {}) {
    super(message ?? 'Something went wrong. Please try again.');
    this.name = 'ApiError';
    this.status = status;
    this.code = code ?? 'UNKNOWN';
    this.details = details;
  }
}

// The access token lives only in memory. The refresh token is an httpOnly cookie
// that scripts cannot read, so reloading the page restores the session through it.
let accessToken = null;
let refreshInFlight = null;
let onSessionLost = () => {};

// A plain marker (no secret) remembering that this browser signed in, so that
// visitors who never did are not asked to renew a session they do not have.
const SESSION_HINT_KEY = 'session-hint';

function hasSessionHint() {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return true; // storage unavailable: fall back to asking the server
  }
}

function setSessionHint(present) {
  try {
    if (present) localStorage.setItem(SESSION_HINT_KEY, '1');
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // storage unavailable: nothing to remember
  }
}

/** Sets the access token after sign-in, or clears it (null) after sign-out. */
export function setAccessToken(token) {
  accessToken = token;
  setSessionHint(token !== null);
}

/** The current access token, for the live chat connection (it lives only in memory). */
export const getAccessToken = () => accessToken;

/** Called when a signed-in request finds the session gone and it cannot be renewed. */
export function setSessionLostHandler(handler) {
  onSessionLost = handler;
}

async function send(path, { method = 'GET', body, auth = true } = {}) {
  // A FormData body (file uploads) is sent as is; the browser sets its content type.
  const isForm = body instanceof FormData;
  const headers = {};
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined || isForm ? body : JSON.stringify(body),
      credentials: 'include',
    });
  } catch {
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the server. Check your connection and try again.',
    });
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data?.error);
  return data;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestNewAccessToken() {
  try {
    return (await send('/auth/refresh', { method: 'POST', auth: false })).accessToken;
  } catch (error) {
    if (error.status !== 401) throw error;
  }
  // Another tab may have renewed the session a moment ago, replacing the cookie
  // this request carried. One retry picks up the new cookie.
  await wait(400);
  try {
    return (await send('/auth/refresh', { method: 'POST', auth: false })).accessToken;
  } catch (error) {
    if (error.status !== 401) throw error;
    return null;
  }
}

/**
 * Renews the session from the refresh cookie. Returns whether the user is signed in.
 * Concurrent callers share one request, because each refresh token works only once.
 */
export function refreshSession() {
  if (!refreshInFlight) {
    if (!hasSessionHint()) return Promise.resolve(false);
    refreshInFlight = requestNewAccessToken()
      .then((token) => {
        setAccessToken(token);
        return token !== null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * Calls the API. Pass `auth: false` for endpoints used while signed out.
 * A signed-in request that gets 401 renews the session once and retries.
 */
export async function api(path, options = {}) {
  const signedIn = options.auth !== false;
  try {
    return await send(path, options);
  } catch (error) {
    if (!signedIn || error.status !== 401) throw error;
  }

  if (await refreshSession()) return send(path, options);

  onSessionLost();
  throw new ApiError(401, {
    code: 'SESSION_EXPIRED',
    message: 'Your session has ended. Please sign in again.',
  });
}

/** Field-level messages from a validation error, keyed by field name. */
export function fieldErrors(error) {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return {};
  const errors = {};
  for (const { path, message } of error.details ?? []) {
    if (path && !errors[path]) errors[path] = message;
  }
  return errors;
}
