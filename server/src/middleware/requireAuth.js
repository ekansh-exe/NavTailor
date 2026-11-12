import { COOKIE_NAME, verifySession } from '../auth/session.js';

// Runs before protected route handlers. Either sets req.user and calls next(),
// or stops the request with a 401. Handlers must scope every query to req.user.id.
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  let payload;
  try {
    payload = verifySession(token);
  } catch {
    // Bad signature, expired or malformed. Generic message, token never logged.
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.user = { id: payload.sub };
  next();
}
