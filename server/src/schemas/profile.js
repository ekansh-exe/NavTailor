import { z } from 'zod';

// Shared validation for the master profile. The API uses it to check what the client
// sends; later the same item schemas can check what the LLM returns.
// Mongoose (models/Profile.js) guards storage. This file guards input.

// Hard caps, so one request can never carry a giant payload or prompt-stuffed text.
const LIMIT = {
  id: 40,
  tag: 60, // a skill name, e.g. "React"
  short: 200, // names, titles, schools, locations...
  dates: 60,
  grade: 60, // free text on purpose: "8.7 / 10 CGPA", "3.8 GPA", "First Class", "85%"
  year: 20,
  phone: 40,
  email: 254,
  url: 500,
  bullet: 500,
  summary: 1000,
  links: 10,
  education: 10,
  experience: 20,
  experienceBullets: 15,
  projects: 20,
  projectBullets: 10,
  certifications: 30,
  achievement: 300, // one line, e.g. "Winner, Smart India Hackathon 2024 among 500+ teams"
  achievements: 15,
  activities: 15,
  heading: 60, // the user's own name for the activities section
  skillList: 60, // languages, frameworks, tools: max items each
  itemSkills: 15, // skill tags on one bullet / project / certification
};

// Free text, trimmed, optional (missing -> ""), length-capped.
const text = (max) => z.string().trim().max(max).default('');

// An id is how the LLM will point at an item ("exp1", "b3"). Keep it boring and safe.
const id = z
  .string()
  .trim()
  .min(1)
  .max(LIMIT.id)
  .regex(/^[A-Za-z0-9_-]+$/, 'Use only letters, numbers, "_" and "-"');

// Exported so the tailoring schemas (selection, scored items) can point at items by the same id rule.
export const idSchema = id;

// Only http(s) links, so things like "javascript:" can never get into the profile.
const url = z.url({ protocol: /^https?$/ }).max(LIMIT.url);
const emptyOr = (schema) => z.union([z.literal(''), schema]).default('');

const tag = z.string().trim().min(1).max(LIMIT.tag);
const tags = (maxItems) => z.array(tag).max(maxItems).default([]);

// z.strictObject rejects keys we did not define, so a typo ("bulets") or a sneaky
// "userId" fails loudly instead of being silently dropped.
export const basicsSchema = z.strictObject({
  name: text(LIMIT.short),
  email: emptyOr(z.email().max(LIMIT.email)),
  phone: text(LIMIT.phone),
  location: text(LIMIT.short),
  links: z.array(url).max(LIMIT.links).default([]),
});

export const educationItemSchema = z.strictObject({
  id,
  school: text(LIMIT.short),
  degree: text(LIMIT.short),
  dates: text(LIMIT.dates),
  // Optional: text() defaults to "", so profiles saved before this field existed still validate.
  grade: text(LIMIT.grade),
});

export const experienceBulletSchema = z.strictObject({
  id,
  text: text(LIMIT.bullet),
  skills: tags(LIMIT.itemSkills),
  alwaysInclude: z.boolean().default(false),
});

export const experienceItemSchema = z.strictObject({
  id,
  company: text(LIMIT.short),
  role: text(LIMIT.short),
  dates: text(LIMIT.dates),
  // Optional ("Bangalore", "Remote"). text() defaults to "", so older profiles still validate.
  location: text(LIMIT.short),
  bullets: z.array(experienceBulletSchema).max(LIMIT.experienceBullets).default([]),
});

// Project bullets have no alwaysInclude (matches the agreed shape).
export const projectBulletSchema = z.strictObject({
  id,
  text: text(LIMIT.bullet),
  skills: tags(LIMIT.itemSkills),
});

export const projectItemSchema = z.strictObject({
  id,
  name: text(LIMIT.short),
  // Optional: a one-line description shown as "Name -- tagline", and a date ("Mar 2024").
  tagline: text(LIMIT.short),
  dates: text(LIMIT.dates),
  link: emptyOr(url),
  skills: tags(LIMIT.itemSkills),
  bullets: z.array(projectBulletSchema).max(LIMIT.projectBullets).default([]),
});

export const certificationItemSchema = z.strictObject({
  id,
  name: text(LIMIT.short),
  issuer: text(LIMIT.short),
  year: text(LIMIT.year),
  skills: tags(LIMIT.itemSkills),
});

// Optional sections. One line of text each; nothing in them is scored or rewritten by the LLM.
export const achievementItemSchema = z.strictObject({
  id,
  text: text(LIMIT.achievement),
});

// A position, club, paper or talk: title on the left, a date or venue on the right.
export const activityItemSchema = z.strictObject({
  id,
  title: text(LIMIT.short),
  detail: text(LIMIT.short),
});

export const skillsSchema = z.strictObject({
  languages: tags(LIMIT.skillList),
  frameworks: tags(LIMIT.skillList),
  tools: tags(LIMIT.skillList),
});

// The original sections are required on purpose: PUT replaces the whole profile, so a request
// that forgets a section is an error, not a silent wipe of that section.
// The optional sections added later (achievements, activities) default to empty instead, so
// tailored resumes saved before they existed still validate when they are rendered again.
export const profileSchema = z
  .strictObject({
    basics: basicsSchema,
    summary: text(LIMIT.summary),
    education: z.array(educationItemSchema).max(LIMIT.education),
    experience: z.array(experienceItemSchema).max(LIMIT.experience),
    projects: z.array(projectItemSchema).max(LIMIT.projects),
    certifications: z.array(certificationItemSchema).max(LIMIT.certifications),
    skills: skillsSchema,
    achievements: z.array(achievementItemSchema).max(LIMIT.achievements).default([]),
    activitiesHeading: text(LIMIT.heading), // "" means the default heading, "Activities"
    activities: z.array(activityItemSchema).max(LIMIT.activities).default([]),
  })
  .superRefine((profile, ctx) => {
    // Ids must be unique across the WHOLE profile (a job, a bullet and a project can
    // not share "b1"), because the LLM refers to items by id alone. MongoDB cannot
    // enforce this inside one document, so we do.
    const seen = new Set();
    const check = (value, path) => {
      if (seen.has(value)) {
        ctx.addIssue({ code: 'custom', path, message: `Duplicate id "${value}"` });
      }
      seen.add(value);
    };

    profile.education.forEach((e, i) => check(e.id, ['education', i, 'id']));
    profile.experience.forEach((job, i) => {
      check(job.id, ['experience', i, 'id']);
      job.bullets.forEach((b, j) => check(b.id, ['experience', i, 'bullets', j, 'id']));
    });
    profile.projects.forEach((p, i) => {
      check(p.id, ['projects', i, 'id']);
      p.bullets.forEach((b, j) => check(b.id, ['projects', i, 'bullets', j, 'id']));
    });
    profile.certifications.forEach((c, i) => check(c.id, ['certifications', i, 'id']));
    profile.achievements.forEach((a, i) => check(a.id, ['achievements', i, 'id']));
    profile.activities.forEach((a, i) => check(a.id, ['activities', i, 'id']));
  });
