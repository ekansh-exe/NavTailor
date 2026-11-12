import mongoose from 'mongoose';

const { Schema } = mongoose;

// One tailoring run for one job: what the user asked for, what the pipeline produced and what the
// user decided about each rewrite.
//
// One user has MANY applications, so unlike Profile (one per user, embedded items) each application
// is its own document that points at its owner through userId. Every query must include userId.

export const APPLICATION_STATUSES = ['tailored', 'reviewed'];

// Per-user cap, so one account cannot fill the free database tier.
export const MAX_APPLICATIONS_PER_USER = 200;

const applicationSchema = new Schema(
  {
    // The owner (a reference to the users collection). Not unique: many applications per user.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    company: { type: String, trim: true, required: true },
    role: { type: String, trim: true, required: true },
    jobDescription: { type: String, required: true },

    // The whole pipeline output (gapReport, changes, resume, scores, ...). Mixed = Mongoose does not
    // check its shape. That is on purpose: zod (tailorResponseSchema) already validated it before the
    // save, and keeping one schema for it means the two cannot drift apart.
    result: { type: Schema.Types.Mixed, required: true },

    // The user's Accept/Reject overrides: change itemId -> true (use rewrite) / false (keep original).
    // A missing key means "the pipeline's default". A Map, because the keys are ids we do not know
    // ahead of time.
    decisions: { type: Map, of: Boolean, default: () => new Map() },

    // tailored: just created. reviewed: the user saved decisions at least once.
    status: { type: String, enum: APPLICATION_STATUSES, default: 'tailored' },
  },
  { timestamps: true },
);

// Compound index for the dashboard query: find({ userId }).sort({ createdAt: -1 }).
// MongoDB jumps to this user's entries, already in newest-first order, instead of scanning and
// sorting the whole collection. It also serves findOne({ _id, userId }) checks via _id.
applicationSchema.index({ userId: 1, createdAt: -1 });

// Model name "Application" -> collection "applications".
export const Application = mongoose.model('Application', applicationSchema);
