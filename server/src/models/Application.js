import mongoose from 'mongoose';

const { Schema } = mongoose;

// One job the user is going after: the company, the role, the job description and where they are in
// the hiring process. The tailored resumes for it live in a SEPARATE collection (resumeVersions) and
// point back here through applicationId.
//
// Why reference instead of embed: an application can collect many versions, each tens of KB. Embedded,
// the document would grow every re-tailor (toward the 16 MB cap), and a tiny status change would
// rewrite every resume. The dashboard never needs the resumes, so they live apart.
//
// One user has MANY applications, so each one points at its owner through userId. Every query must
// include userId.

export const APPLICATION_STATUSES = ['saved', 'applied', 'interview', 'offer', 'rejected'];

// Per-user cap, so one account cannot fill the free database tier.
export const MAX_APPLICATIONS_PER_USER = 200;

const applicationSchema = new Schema(
  {
    // The owner (a reference to the users collection). Not unique: many applications per user.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    company: { type: String, trim: true, required: true },
    role: { type: String, trim: true, required: true },
    jdText: { type: String, required: true },

    // Where the user is with this job. Changed from the dashboard dropdown.
    status: { type: String, enum: APPLICATION_STATUSES, default: 'saved' },

    // How the profile matches THIS job description. It belongs to the job, not to a resume version,
    // and it lives here so the dashboard can show the match score without reading any version.
    // Mixed: zod (gapReportSchema) checked its shape before the save.
    gapReport: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

// Compound index for the dashboard query: find({ userId }).sort({ createdAt: -1 }).
// Equality field first, sort field second. MongoDB jumps to this user's entries, which are already
// in newest-first order, instead of scanning and sorting the whole collection.
applicationSchema.index({ userId: 1, createdAt: -1 });

// Model name "Application" -> collection "applications".
export const Application = mongoose.model('Application', applicationSchema);
