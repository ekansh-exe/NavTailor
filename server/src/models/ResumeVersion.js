import mongoose from 'mongoose';

const { Schema } = mongoose;

// One tailored resume for one application. An application can have many (re-tailor, tweak, again).
//
// It REFERENCES its application through applicationId. MongoDB has no foreign keys: `ref` is only a
// hint for .populate(), and deleting an application does NOT delete its versions by itself. The
// DELETE route does that explicitly (see routes/applications.js).
//
// userId is copied here on purpose, although the application already has it. Every query is scoped to
// the signed-in user, and with userId on the version, one query checks ownership without loading the
// parent first.
//
// No PDF is stored: it is rebuilt from texSource on demand, so it never uses database space.

export const MAX_VERSIONS_PER_APPLICATION = 20;

const resumeVersionSchema = new Schema(
  {
    applicationId: { type: Schema.Types.ObjectId, ref: 'Application', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // The FULL signed tailoring result (resume before decisions, changes, scores, questions, ...).
    // Kept whole so Accept/Reject can be changed later and the resume rebuilt from it.
    // Mixed: zod (tailorResponseSchema) checked it, and the save token proved it came from us.
    result: { type: Schema.Types.Mixed, required: true },

    // The user's Accept/Reject overrides: change itemId -> true (use rewrite) / false (keep original).
    decisions: { type: Map, of: Boolean, default: () => new Map() },

    // Derived from result + decisions by the server. Never sent by the client.
    resumeJson: { type: Schema.Types.Mixed, required: true },
    texSource: { type: String, required: true },
  },
  // Collection name set explicitly, otherwise Mongoose would call it "resumeversions".
  { timestamps: true, collection: 'resumeVersions' },
);

// "Versions of this application, newest first": two equality fields, then the sort field.
// The userId prefix also serves deleteMany({ userId }) when an account is deleted.
resumeVersionSchema.index({ userId: 1, applicationId: 1, createdAt: -1 });

export const ResumeVersion = mongoose.model('ResumeVersion', resumeVersionSchema);
