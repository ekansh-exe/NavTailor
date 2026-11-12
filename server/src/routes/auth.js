import { Router } from 'express';
import { User } from '../models/User.js';
import { verifyGoogleCredential } from '../auth/google.js';
import { setSessionCookie } from '../auth/session.js';

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
