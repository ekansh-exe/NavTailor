// Resume JSON -> one-page, ATS-friendly LaTeX source.
//
// The rule that keeps this safe: resume text can only enter the document through the tex`...`
// tag below, and that tag escapes every ${value} with escapeLatex(). The template's own fixed
// commands are the literal parts of the tagged template, which are written by us and never come
// from data. So "forgot to escape one field" is not a mistake you can make by accident.
//
// ATS-friendly means a parser can read the PDF text in order: one column, standard section names,
// real text only (no images, icons, tables or text boxes), dates on the same line as the entry.

import { profileSchema } from '../schemas/profile.js';
import { escapeLatex, escapeUrl } from './escape.js';

// "Raw" marks LaTeX that is already safe to paste as-is. Only this file creates one: through
// tex`...` (which escapes its values), join() (which only accepts other Raws) and trusted()
// (used once, for a URL that escapeUrl() already processed). The class is not exported.
class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const trusted = (value) => new Raw(value);
const EMPTY = new Raw('');

// Tagged template: tex`\textbf{${name}}`
//   - the literal parts are OUR LaTeX. We use strings.raw so that `\textbf` stays a backslash
//     followed by letters (the "cooked" strings would try to read \t as a tab);
//   - every ${value} that is not a Raw is escaped. A non-string value throws (see escapeLatex).
export function tex(strings, ...values) {
  let out = strings.raw[0];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    out += (value instanceof Raw ? value.value : escapeLatex(value)) + strings.raw[i + 1];
  }
  return new Raw(out);
}

// Joins tex`...` results. A plain string is refused, so text cannot slip in unescaped through here.
// `sep` is typed by us in this file (like "\n" or " \textbar{} "), never data.
export function join(items, sep = '') {
  if (!Array.isArray(items) || !items.every((item) => item instanceof Raw)) {
    throw new TypeError('join expects an array of tex`` results');
  }
  if (typeof sep !== 'string') throw new TypeError('join separator must be a string');
  return new Raw(items.map((item) => item.value).join(sep));
}

// A field "has content" when something is left after escaping (it trims and drops invisible characters).
const has = (value) => escapeLatex(value) !== '';

const linkText = (url) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '');
const link = (url) => tex`\href{${trusted(escapeUrl(url))}}{${linkText(url)}}`;

const PREAMBLE = tex`\documentclass[10pt,letterpaper]{article}
\usepackage[margin=0.6in]{geometry}
\usepackage{fontspec}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
\setlength{\emergencystretch}{3em}
\titleformat{\section}{\large\bfseries}{}{0pt}{}[\titlerule]
\titlespacing*{\section}{0pt}{8pt}{4pt}
\setlist[itemize]{leftmargin=1.2em,itemsep=1pt,topsep=2pt,parsep=0pt,partopsep=0pt}`;

const GAP = '\n\\vspace{3pt}\n';

// Bold text on the left, a date or link on the right, all on ONE line of real text.
const headLine = (left, right) =>
  has(right) ? tex`\textbf{${left}}\hfill ${right}\par` : tex`\textbf{${left}}\par`;

// Entry heading used by jobs and education: the first non-empty of (primary, secondary) is the bold
// line, the other one (if any) goes on an italic line below.
function titled(primary, secondary, dates) {
  const first = has(primary) ? primary : secondary;
  const second = has(primary) ? secondary : '';
  if (!has(first) && !has(dates)) return [];
  const lines = [headLine(first, dates)];
  if (has(second)) lines.push(tex`\textit{${second}}\par`);
  return lines;
}

// \item\relax stops LaTeX from reading a bullet that starts with "[" as the optional
// argument of \item. An empty itemize is a LaTeX error, so no bullets means no list.
function bullets(texts) {
  const items = texts.filter(has);
  if (!items.length) return null;
  return tex`\begin{itemize}
${join(items.map((text) => tex`\item\relax ${text}`), '\n')}
\end{itemize}`;
}

function header(basics) {
  const lines = [];
  if (has(basics.name)) lines.push(tex`{\LARGE\bfseries ${basics.name}}\par`);
  const contact = [basics.email, basics.phone, basics.location]
    .filter(has)
    .map((value) => tex`${value}`)
    .concat(basics.links.map(link));
  if (contact.length) lines.push(tex`${join(contact, ' \\textbar{} ')}\par`);
  if (!lines.length) return null;
  return tex`\begin{center}
${join(lines, '\n')}
\end{center}`;
}

const section = (title, blocks, sep) =>
  blocks.length ? tex`\section*{${title}}
${join(blocks, sep)}` : null;

function summarySection(resume) {
  return section('Summary', has(resume.summary) ? [tex`${resume.summary}\par`] : [], '\n');
}

function experienceSection(resume) {
  const jobs = resume.experience
    .map((job) => {
      const parts = titled(job.company, job.role, job.dates);
      const list = bullets(job.bullets.map((b) => b.text));
      if (list) parts.push(list);
      return parts.length ? join(parts, '\n') : null;
    })
    .filter(Boolean);
  return section('Experience', jobs, GAP);
}

function projectsSection(resume) {
  const projects = resume.projects
    .map((project) => {
      const tech = project.skills.filter(has);
      const list = bullets(project.bullets.map((b) => b.text));
      if (!has(project.name) && !list) return null;
      const stack = tech.length ? tex` \textbar{} ${tech.join(', ')}` : EMPTY;
      const where = has(project.link) ? tex`\hfill ${link(project.link)}` : EMPTY;
      const parts = [tex`\textbf{${project.name}}${stack}${where}\par`];
      if (list) parts.push(list);
      return join(parts, '\n');
    })
    .filter(Boolean);
  return section('Projects', projects, GAP);
}

function educationSection(resume) {
  const items = resume.education
    .map((edu) => {
      // Plain text on purpose: titled() puts it through tex``, which escapes it exactly once.
      const detail = [edu.degree, edu.grade].filter(has).join(', ');
      const lines = titled(edu.school, detail, edu.dates);
      return lines.length ? join(lines, '\n') : null;
    })
    .filter(Boolean);
  return section('Education', items, GAP);
}

function skillsSection(resume) {
  const rows = [
    ['Languages', resume.skills.languages],
    ['Frameworks', resume.skills.frameworks],
    ['Tools', resume.skills.tools],
  ]
    .map(([label, list]) => [label, list.filter(has)])
    .filter(([, list]) => list.length)
    .map(([label, list]) => tex`\textbf{${label}:} ${list.join(', ')}\par`);
  return section('Skills', rows, '\n');
}

function certificationsSection(resume) {
  const certs = resume.certifications
    .filter((cert) => has(cert.name))
    .map((cert) => {
      const issuer = has(cert.issuer) ? tex`, ${cert.issuer}` : EMPTY;
      const year = has(cert.year) ? tex`\hfill ${cert.year}` : EMPTY;
      return tex`\textbf{${cert.name}}${issuer}${year}\par`;
    });
  return section('Certifications', certs, '\n');
}

// The only public entry point. `resume` is a tailored profile (same shape as a stored profile).
// It is validated again here so a direct caller cannot hand us a different shape.
// Returns the complete .tex source as a string.
export function renderResume(input) {
  const resume = profileSchema.parse(input);
  const blocks = [
    header(resume.basics),
    summarySection(resume),
    experienceSection(resume),
    projectsSection(resume),
    educationSection(resume),
    skillsSection(resume),
    certificationsSection(resume),
  ].filter(Boolean);

  // A document with no content produces no PDF page at all, which is a LaTeX error. \null forces one.
  const body = blocks.length ? join(blocks, '\n\n') : tex`\null`;

  return tex`${PREAMBLE}

\begin{document}
${body}
\end{document}
`.toString();
}
