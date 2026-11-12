import { z } from 'zod';
import { profileSchema } from '../schemas/profile.js';

// What we accept from the LLM: exactly the profile shape and every per-field cap from
// schemas/profile.js, but WITHOUT the "ids are unique" rule (that is a superRefine on
// profileSchema, which we deliberately do not copy). The model is asked for ids, yet we
// rewrite them by position afterwards (buildDraft.js), so a duplicate id from the model
// must not waste a retry on a free-tier quota.
export const importSchema = z.strictObject(profileSchema.shape);
