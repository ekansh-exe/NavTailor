// Shared constants and small helpers for the profile editor.

// Mirrors the caps in server/src/schemas/profile.js. The server is the real gatekeeper;
// these just stop you typing past a limit and disable "Add" buttons at the maximum.
// If you change a limit on the server, change it here too.
export const LIMIT = {
  tag: 60,
  short: 200,
  dates: 60,
  grade: 60,
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
  achievement: 300,
  achievements: 15,
  activities: 15,
  heading: 60,
  skillList: 60,
  itemSkills: 15,
};

// Item ids are how the LLM will point at things later ("use bullet b_k3j9x2"), so they
// must stay stable once created. Random suffix: unique across the profile in practice,
// and matches the server's rule (letters, numbers, "_" and "-", max 40 chars).
export function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export const newEducation = () => ({ id: newId('edu'), school: '', degree: '', dates: '', grade: '' });

export const newExperienceBullet = () => ({
  id: newId('b'),
  text: '',
  skills: [],
  alwaysInclude: false,
});

export const newProjectBullet = () => ({ id: newId('b'), text: '', skills: [] });

export const newExperience = () => ({
  id: newId('exp'),
  company: '',
  role: '',
  dates: '',
  location: '',
  bullets: [],
});

export const newProject = () => ({
  id: newId('p'),
  name: '',
  tagline: '',
  dates: '',
  link: '',
  skills: [],
  bullets: [],
});

export const newCertification = () => ({
  id: newId('c'),
  name: '',
  issuer: '',
  year: '',
  skills: [],
});

export const newAchievement = () => ({ id: newId('ach'), text: '' });

export const newActivity = () => ({ id: newId('act'), title: '', detail: '' });

// Immutable list helpers. React only re-renders when it sees a NEW object/array, so we
// never mutate: each helper returns a fresh copy.
export const setAt = (list, index, patch) =>
  list.map((item, i) => (i === index ? { ...item, ...patch } : item));

export const removeAt = (list, index) => list.filter((_, i) => i !== index);

// What we send to PUT. Empty link rows (added but never filled in) are dropped.
export function cleanForSave(profile) {
  return {
    ...profile,
    basics: {
      ...profile.basics,
      links: profile.basics.links.map((l) => l.trim()).filter(Boolean),
    },
  };
}

// True when there is nothing in the profile worth protecting from an overwrite.
export function isProfileEmpty(p) {
  return (
    !p.basics.name &&
    !p.basics.email &&
    !p.basics.phone &&
    !p.basics.location &&
    p.basics.links.length === 0 &&
    !p.summary &&
    p.education.length === 0 &&
    p.experience.length === 0 &&
    p.projects.length === 0 &&
    p.certifications.length === 0 &&
    !p.achievements?.length &&
    !p.activities?.length &&
    p.skills.languages.length === 0 &&
    p.skills.frameworks.length === 0 &&
    p.skills.tools.length === 0
  );
}

// "experience.0.bullets.1.text" -> "Experience › #1 › Bullets › #2 › text"
export function formatIssuePath(path) {
  if (!path) return 'Profile';
  return path
    .split('.')
    .map((part, i) => {
      if (/^\d+$/.test(part)) return `#${Number(part) + 1}`;
      return i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part;
    })
    .join(' › ');
}
