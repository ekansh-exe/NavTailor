import mongoose from 'mongoose';

const { Schema } = mongoose;

// Small helpers so the field list below stays readable.
const text = { type: String, trim: true, default: '' };
const stringList = () => [{ type: String, trim: true }];
const itemId = { type: String, required: true, trim: true };

// Everything below is EMBEDDED inside the one Profile document: a job, a bullet or a
// project has no life outside its profile, is always read together with it, and is
// small. Only userId is a reference (to the users collection).
//
// _id: false because each item carries its own string `id` ("exp1", "b3"). That is
// what the LLM will return when it selects items, so we do not want a second id.
const subdoc = { _id: false };

const educationSchema = new Schema(
  // grade was added later: older stored items have no grade, and Mongoose fills "" when it reads them.
  { id: itemId, school: text, degree: text, dates: text, grade: text },
  subdoc,
);

const experienceBulletSchema = new Schema(
  {
    id: itemId,
    text,
    skills: stringList(),
    alwaysInclude: { type: Boolean, default: false },
  },
  subdoc,
);

const experienceSchema = new Schema(
  {
    id: itemId,
    company: text,
    role: text,
    dates: text,
    bullets: [experienceBulletSchema],
  },
  subdoc,
);

const projectBulletSchema = new Schema(
  { id: itemId, text, skills: stringList() },
  subdoc,
);

const projectSchema = new Schema(
  {
    id: itemId,
    name: text,
    link: text,
    skills: stringList(),
    bullets: [projectBulletSchema],
  },
  subdoc,
);

const certificationSchema = new Schema(
  { id: itemId, name: text, issuer: text, year: text, skills: stringList() },
  subdoc,
);

const profileSchema = new Schema(
  {
    // The owner. unique: true builds a unique index, which does two jobs:
    //  1. every profile read is findOne({ userId }), so the index makes it a direct lookup;
    //  2. it guarantees ONE profile per user even when two requests race to create it.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    // Nested objects (not arrays): plain sub-paths of this document.
    basics: {
      name: text,
      email: text,
      phone: text,
      location: text,
      links: stringList(),
    },
    summary: text,

    education: [educationSchema],
    experience: [experienceSchema],
    projects: [projectSchema],
    certifications: [certificationSchema],

    skills: {
      languages: stringList(),
      frameworks: stringList(),
      tools: stringList(),
    },
  },
  {
    // createdAt AND updatedAt: unlike a User, a profile is edited over time.
    timestamps: true,
  },
);

// Model name "Profile" -> collection "profiles".
export const Profile = mongoose.model('Profile', profileSchema);
