import { Router } from 'express';
import { Profile } from '../models/Profile.js';
import { profileSchema } from '../schemas/profile.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const profileRouter = Router();

// Applied to the whole router, so a route added here later cannot forget the auth check.
profileRouter.use(requireAuth);

// Only the profile content leaves the server. No _id, __v or userId.
// The keys come from the zod schema, so the two cannot drift apart.
const PROFILE_KEYS = Object.keys(profileSchema.shape);
function toPublicProfile(doc) {
  const data = doc.toObject();
  return Object.fromEntries(PROFILE_KEYS.map((key) => [key, data[key]]));
}

// Find-or-create/update in ONE atomic database operation, scoped to the owner.
// userId is always req.user.id (from the verified JWT), never anything from the request.
async function upsertProfile(userId, update) {
  const filter = { userId };
  const options = { upsert: true, returnDocument: 'after', runValidators: true };

  try {
    return await Profile.findOneAndUpdate(filter, update, options);
  } catch (err) {
    // Two simultaneous first requests can race on the unique userId index.
    // The loser gets E11000; retrying now finds the winner's document.
    if (err.code === 11000) return Profile.findOneAndUpdate(filter, update, options);
    throw err;
  }
}

// Returns the user's profile. Creates an empty one the first time.
profileRouter.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    // $setOnInsert only applies when the document is being created, so an existing
    // profile is returned untouched.
    const profile = await upsertProfile(userId, { $setOnInsert: { userId } });
    return res.json({ profile: toPublicProfile(profile) });
  } catch (err) {
    console.error('Loading profile failed:', err.message);
    return res.status(500).json({ error: 'Could not load profile' });
  }
});

// Replaces the whole profile content with the validated body.
profileRouter.put('/', async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    // Paths and messages only. The body (someone's resume) is never echoed or logged.
    const issues = parsed.error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return res.status(400).json({ error: 'Invalid profile', issues });
  }

  try {
    const profile = await upsertProfile(req.user.id, { $set: parsed.data });
    return res.json({ profile: toPublicProfile(profile) });
  } catch (err) {
    console.error('Saving profile failed:', err.message);
    return res.status(500).json({ error: 'Could not save profile' });
  }
});
