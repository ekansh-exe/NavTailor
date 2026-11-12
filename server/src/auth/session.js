import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const COOKIE_NAME = 'session';

const SESSION_SECONDS = 7 * 24 * 60 * 60; // 7 days

// One options object for set AND clear. A cookie is only deleted if the
// browser sees the same name + path (+ flags), so these must never drift apart.
export const cookieOptions = {
  httpOnly: true, // JavaScript cannot read it, so XSS cannot steal it
  // https only, except in local development (plain http://localhost). Fails closed: see config.js.
  secure: !config.isDevelopment,
  sameSite: 'lax', // not sent on cross-site POSTs (CSRF defence)
  path: '/',
};

// The only claim we put in is the user id ("sub"). jsonwebtoken adds iat/exp itself.
export function signSession(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: SESSION_SECONDS,
  });
}

// Throws if the signature is wrong, the token is expired or malformed.
// Pinning the algorithm stops "alg: none" and algorithm-swap tricks.
export function verifySession(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

export function setSessionCookie(res, userId) {
  res.cookie(COOKIE_NAME, signSession(userId), {
    ...cookieOptions,
    maxAge: SESSION_SECONDS * 1000, // cookie maxAge is in milliseconds
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions);
}
