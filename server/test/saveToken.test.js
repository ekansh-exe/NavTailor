// Unit tests for the save token: what it accepts and what it refuses.
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

let signResult;
let verifyResult;
let SAVE_TOKEN_TTL_MS;

before(async () => {
  process.env.JWT_SECRET ||= 'test-secret-for-save-token-0123456789';
  process.env.CLIENT_ORIGIN ||= 'http://localhost:5173';
  process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/unused';
  process.env.GOOGLE_CLIENT_ID ||= 'test-client-id';
  ({ signResult, verifyResult, SAVE_TOKEN_TTL_MS } = await import('../src/tailor/saveToken.js'));
});

const input = () => ({ userId: 'u1', jdText: 'We need React.', result: { resume: { summary: 'Hi' }, scores: { a: 1 } } });

describe('save token', () => {
  test('a fresh token for the same input verifies', () => {
    const token = signResult(input());
    assert.match(token, /^\d+\.[a-f0-9]{64}$/);
    assert.equal(verifyResult({ ...input(), token }), 'ok');
  });

  test('changing the user, the job description or one character of the result breaks it', () => {
    const token = signResult(input());
    assert.equal(verifyResult({ ...input(), token, userId: 'u2' }), 'invalid');
    assert.equal(verifyResult({ ...input(), token, jdText: 'We need Rust.' }), 'invalid');
    const changed = input();
    changed.result.resume.summary = 'Hi!';
    assert.equal(verifyResult({ ...changed, token }), 'invalid');
  });

  test('editing the expiry to extend a token breaks it', () => {
    const token = signResult(input());
    const [exp, mac] = token.split('.');
    assert.equal(verifyResult({ ...input(), token: `${Number(exp) + 1000}.${mac}` }), 'invalid');
  });

  test('an old token is expired', () => {
    const now = Date.now();
    const token = signResult({ ...input(), now: now - SAVE_TOKEN_TTL_MS - 1 });
    assert.equal(verifyResult({ ...input(), token, now }), 'expired');
  });

  test('junk never throws', () => {
    for (const token of [undefined, null, '', 'abc', '1.2', `${'1'.repeat(13)}.${'z'.repeat(64)}`, { a: 1 }]) {
      assert.equal(verifyResult({ ...input(), token }), 'invalid');
    }
  });
});
