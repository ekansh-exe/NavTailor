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

export const skillsSchema = z.strictObject({
  languages: tags(LIMIT.skillList),
  frameworks: tags(LIMIT.skillList),
  tools: tags(LIMIT.skillList),
});

// Every top-level section is required on purpose: PUT replaces the whole profile,
// so a request that forgets a section is an error, not a silent wipe of that section.
export const profileSchema = z
  .strictObject({
    basics: basicsSchema,
    summary: text(LIMIT.summary),
    education: z.array(educationItemSchema).max(LIMIT.education),
    experience: z.array(experienceItemSchema).max(LIMIT.experience),
    projects: z.array(projectItemSchema).max(LIMIT.projects),
    certifications: z.array(certificationItemSchema).max(LIMIT.certifications),
    skills: skillsSchema,
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
  });
