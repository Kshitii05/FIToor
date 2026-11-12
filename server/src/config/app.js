import { env } from './env.js';

// The product name is not final. Everything on the server that needs it (API responses,
// emails, notifications) imports this constant; never write the name as a literal.
export const APP_NAME = env.APP_NAME;

export const API_PREFIX = '/api/v1';
