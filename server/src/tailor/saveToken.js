// A "save token" proves that a tailoring result came from OUR server, for THIS user and THIS job
// description, and was not changed on the way back.
//
// Why it exists: POST /api/tailor saves nothing. The client keeps the result, the user reviews it, and
// only then presses Save, which sends the result back. Without a check, a hand-crafted request could
// save a "result" with invented bullets, which breaks the "never fabricate" rule.
//
// How: HMAC-SHA256 over (userId, jdText, expiry, sha256 of the result JSON), keyed with a secret only
// the server knows. Change one byte of any part and the HMAC no longer matches. Nothing is stored.
//
// Token format: "<expiry ms>.<hex hmac>". It holds no resume text.

import crypto from 'node:crypto';
import { config } from '../config.js';

export const SAVE_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours to review before saving

// A separate key derived from JWT_SECRET, so a save token can never be confused with a session JWT
// (and no new env var is needed).
const key = () => crypto.createHmac('sha256', config.jwtSecret).update('navtailor:save-result:v1').digest();

// The result must be serialised the same way when signing and when verifying. Both sides pass a
// value that zod just parsed with tailorResponseSchema, which emits keys in schema order.
const digest = (result) => crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');

function mac({ userId, jdText, exp, result }) {
  // \n separates the parts so ("ab", "c") and ("a", "bc") cannot produce the same input.
  return crypto
    .createHmac('sha256', key())
    .update(`${userId}\n${exp}\n${digest(result)}\n${jdText}`)
    .digest('hex');
}

export function signResult({ userId, jdText, result, now = Date.now() }) {
  const exp = now + SAVE_TOKEN_TTL_MS;
  return `${exp}.${mac({ userId, jdText, exp, result })}`;
}

// Returns 'ok', 'expired' or 'invalid'. Never throws.
export function verifyResult({ token, userId, jdText, result, now = Date.now() }) {
  const match = /^(\d{13,16})\.([a-f0-9]{64})$/.exec(String(token ?? ''));
  if (!match) return 'invalid';
  const exp = Number(match[1]);

  const expected = Buffer.from(mac({ userId, jdText, exp, result }), 'hex');
  const given = Buffer.from(match[2], 'hex');
  // timingSafeEqual takes the same time however many bytes match, so an attacker cannot guess the
  // HMAC one byte at a time by measuring response times.
  if (!crypto.timingSafeEqual(expected, given)) return 'invalid';
  // Checked after the HMAC, so the expiry itself cannot be edited to extend a token.
  return now > exp ? 'expired' : 'ok';
}
