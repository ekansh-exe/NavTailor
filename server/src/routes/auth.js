import { Router } from 'express';
import { User } from '../models/User.js';
import { verifyGoogleCredential } from '../auth/google.js';
import { clearSessionCookie, setSessionCookie } from '../auth/session.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const authRouter = Router();

// Only these fields ever leave the server. No googleId, no __v.
function toPublicUser(user) {
  return { id: user.id, email: user.email, name: user.name, picture: user.picture };
}

// Find-or-create in ONE atomic database operation (see the upsert explanation).
async function upsertUser(profile) {
  const filter = { googleId: profile.sub };
  const update = { $set: { email: profile.email, name: profile.name, picture: profile.picture } };
  const options = { upsert: true, returnDocument: 'after', runValidators: true };

  try {
    return await User.findOneAndUpdate(filter, update, options);
  } catch (err) {
    // Two simultaneous first logins can race on the unique googleId index.
    // The loser gets E11000; retrying now finds the winner's document.
    if (err.code === 11000) return User.findOneAndUpdate(filter, update, options);
    throw err;
  }
}

authRouter.post('/google', async (req, res) => {
  const credential = req.body?.credential;
  if (typeof credential !== 'string' || credential.length === 0) {
    return res.status(400).json({ error: 'Missing credential' });
  }

  let profile;
  try {
    profile = await verifyGoogleCredential(credential);
  } catch {
    // Deliberately generic, and the credential is never logged.
    return res.status(401).json({ error: 'Invalid Google credential' });
  }

  if (!profile.email || profile.email_verified !== true) {
    return res.status(401).json({ error: 'Google email is not verified' });
  }

  try {
    const user = await upsertUser(profile);
    setSessionCookie(res, user.id);
    return res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error('Login failed:', err.message);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// The JWT only proves "this is user id X". Load the real user from the database.
// The query is scoped to req.user.id, which comes from the verified token.
authRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      // Valid token for a user that no longer exists: end the session.
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error('Loading current user failed:', err.message);
    return res.status(500).json({ error: 'Could not load user' });
  }
});

// Not protected: clearing a cookie is harmless and safe to repeat.
authRouter.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
