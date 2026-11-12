import { Profile } from '../models/Profile.js';
import { profileSchema } from '../schemas/profile.js';

// Shared by every route that reads the signed-in user's saved profile (resume, tailor).
// One place, so the "scoped to the owner" rule cannot be forgotten in a copy.

const PROFILE_KEYS = Object.keys(profileSchema.shape);

// The profile content of ONE user, looked up by the id from the verified session. Never _id, __v or
// userId (same idea as toPublicProfile in routes/profile.js). null when the user has no profile yet.
export async function loadSavedProfile(userId) {
  const doc = await Profile.findOne({ userId });
  if (!doc) return null;
  const data = doc.toObject();
  return Object.fromEntries(PROFILE_KEYS.map((key) => [key, data[key]]));
}

// A validated profile with nothing in it (what a brand-new account has).
export function isEmptyProfile(p) {
  return (
    !p.basics.name && !p.summary &&
    !p.education.length && !p.experience.length && !p.projects.length && !p.certifications.length &&
    !p.achievements?.length && !p.activities?.length &&
    !p.skills.languages.length && !p.skills.frameworks.length && !p.skills.tools.length
  );
}
