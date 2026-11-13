/* global __APP_NAME__, __APP_TAGLINE__ */

// The product name is written once, as APP_NAME in the root .env, and injected at
// build time. Every component that shows the name imports it from here; the name
// is never typed into a component.
export const APP_NAME = __APP_NAME__;

// Optional short line shown next to the name (APP_TAGLINE in the root .env).
export const APP_TAGLINE = __APP_TAGLINE__;

export const API_BASE_URL = '/api/v1';
