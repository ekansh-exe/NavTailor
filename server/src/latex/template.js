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

// Layout: the user's chosen template (A4, tight margins, ruled section titles, hollow-circle
// bullets). Deliberate differences from the original file, all for ATS text extraction:
//   - Fira Sans instead of Source Sans Pro: Tectonic's Source Sans Pro maps "-" to U+2011 in the
//     PDF text layer, so "full-stack" would not match an ATS search for "full-stack"
//   - uppercase section titles instead of small caps: small caps extract as "EDUCATiON"
//   - no tabular in the header: tables confuse ATS parsers, so contact rows are plain centered lines
//   - no "\\" line breaks: every line ends in \par, so the control symbol "\\" never appears at all
// The font is loaded by FILE name. A family name only works when the font is installed on the
// machine; these .otf files ship inside Tectonic's own bundle, so this works anywhere.
const PREAMBLE = tex`\documentclass[a4paper,10pt]{article}
\usepackage[a4paper,left=0.45in,right=0.45in,top=0.3in,bottom=0.3in]{geometry}
\usepackage{fontspec}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}
\setmainfont{FiraSans}[Extension=.otf,UprightFont=*-Regular,BoldFont=*-SemiBold,ItalicFont=*-Italic,BoldItalicFont=*-SemiBoldItalic]
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
\hyphenpenalty=10000
\exhyphenpenalty=10000
\raggedright
\titleformat{\section}{\vspace{3pt}\large\bfseries}{}{0em}{\MakeUppercase}[\titlerule]
\titlespacing*{\section}{0pt}{5pt}{3pt}
\setlist[itemize]{label=$\circ$,leftmargin=1.6em,itemsep=1pt,topsep=2pt,parsep=0pt,partopsep=0pt}`;

const GAP = '\n\\vspace{4pt}\n';

// Like has(), but also accepts a tex`` result (the project link arrives already built).
const present = (value) => (value instanceof Raw ? value.value !== '' : has(value));

// One line: left part, then (if there is one) a right-aligned part, as ONE line of real text.
const line = (left, right) => (present(right) ? tex`${left}\hfill ${right}\par` : tex`${left}\par`);

// The two-line entry heading of the template:
//   bold title ............................ dates
//   italic subtitle ................. italic detail
// Either line is left out when it would be empty. The texts are already tex`` results.
// The italic parts use the group form {\itshape ...}, not \textit{...}: an \href inside a command's
// ARGUMENT has its "#" read as a macro parameter, which is a LaTeX error. In a plain group, \href
// reads its URL itself, exactly as it does at the top level.
const italic = (value) => tex`{\itshape\small ${value}}`;
function heading(title, dates, subtitle, detail) {
  const lines = [];
  if (title || present(dates)) lines.push(line(title ? tex`\textbf{${title}}` : EMPTY, dates));
  if (subtitle || present(detail)) {
    const right = present(detail) ? tex`\hfill${italic(detail)}` : EMPTY;
    lines.push(tex`${subtitle ? italic(subtitle) : EMPTY}${right}\par`);
  }
  return lines;
}

// A plain string -> tex``, or null when it is empty (so callers can test it with `if`).
const opt = (value) => (has(value) ? tex`${value}` : null);

// Jobs and education: the first non-empty of (primary, secondary) is the bold title, the other one
// (if any) the italic subtitle.
function titled(primary, secondary, dates, detail) {
  const first = opt(primary) ?? opt(secondary);
  const second = has(primary) ? opt(secondary) : null;
  return heading(first, dates, second, detail);
}

// \item\relax stops LaTeX from reading a bullet that starts with "[" as the optional
// argument of \item. An empty itemize is a LaTeX error, so no bullets means no list.
function bullets(texts) {
  const items = texts.filter(has);
  if (!items.length) return null;
  return tex`\begin{itemize}
${join(items.map((text) => tex`\item\relax\small ${text}`), '\n')}
\end{itemize}`;
}

const SEPARATOR = '\\hspace{0.8em}\\textbar{}\\hspace{0.8em}';

function header(basics) {
  const lines = [];
  if (has(basics.name)) lines.push(tex`{\LARGE\textbf{${basics.name}}}\par\vspace{2pt}`);
  const contact = [basics.email, basics.phone, basics.location].filter(has).map((value) => tex`${value}`);
  if (contact.length) lines.push(tex`${join(contact, SEPARATOR)}\par`);
  if (basics.links.length) lines.push(tex`${join(basics.links.map(link), SEPARATOR)}\par`);
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

function educationSection(resume) {
  const items = resume.education
    .map((edu) => {
      const lines = titled(edu.school, edu.degree, edu.dates, edu.grade);
      return lines.length ? join(lines, '\n') : null;
    })
    .filter(Boolean);
  return section('Education', items, GAP);
}

function experienceSection(resume) {
  const jobs = resume.experience
    .map((job) => {
      const parts = titled(job.company, job.role, job.dates, job.location);
      const list = bullets(job.bullets.map((b) => b.text));
      if (list) parts.push(list);
      return parts.length ? join(parts, '\n') : null;
    })
    .filter(Boolean);
  return section('Work Experience', jobs, GAP);
}

function projectsSection(resume) {
  const projects = resume.projects
    .map((project) => {
      const list = bullets(project.bullets.map((b) => b.text));
      if (!has(project.name) && !has(project.tagline) && !list) return null;
      // "Name -- tagline", or whichever of the two exists.
      const title = has(project.name) && has(project.tagline)
        ? tex`${project.name} -- ${project.tagline}`
        : opt(project.name) ?? opt(project.tagline);
      const tech = project.skills.filter(has);
      const where = has(project.link) ? link(project.link) : null;
      // The link goes through heading() as a tex`` result, so it is not escaped a second time.
      const parts = heading(title, project.dates, tech.length ? tex`${tech.join(', ')}` : null, where ?? '');
      if (list) parts.push(list);
      return parts.length ? join(parts, '\n') : null;
    })
    .filter(Boolean);
  return section('Projects', projects, GAP);
}

function activitiesSection(resume) {
  const rows = resume.activities
    .filter((a) => has(a.title))
    .map((a) => line(tex`${a.title}`, a.detail));
  const title = has(resume.activitiesHeading) ? resume.activitiesHeading : 'Activities';
  return section(title, rows, '\n\\vspace{2pt}\n');
}

function skillsSection(resume) {
  const rows = [
    ['Programming Languages', resume.skills.languages],
    ['Frameworks & Libraries', resume.skills.frameworks],
    ['Tools & Platforms', resume.skills.tools],
  ]
    .map(([label, list]) => [label, list.filter(has)])
    .filter(([, list]) => list.length)
    .map(([label, list]) => tex`\textbf{${label}:} ${list.join(', ')}\par`);
  if (!rows.length) return null;
  return section('Skills', [tex`{\small\setlength{\parskip}{3pt}
${join(rows, '\n')}
}`], '\n');
}

function certificationsSection(resume) {
  const certs = resume.certifications
    .filter((cert) => has(cert.name))
    .map((cert) => {
      const issuer = has(cert.issuer) ? tex`, ${cert.issuer}` : EMPTY;
      return line(tex`\textbf{${cert.name}}${issuer}`, cert.year);
    });
  return section('Certifications', certs, '\n');
}

function achievementsSection(resume) {
  const items = resume.achievements.map((a) => a.text).filter(has);
  if (!items.length) return null;
  return section('Achievements', [tex`\begin{itemize}[label=\textbullet,leftmargin=1.2em]
${join(items.map((text) => tex`\item\relax ${text}`), '\n')}
\end{itemize}`], '\n');
}

// The only public entry point. `resume` is a tailored profile (same shape as a stored profile).
// It is validated again here so a direct caller cannot hand us a different shape.
// Returns the complete .tex source as a string. Section order follows the user's template.
export function renderResume(input) {
  const resume = profileSchema.parse(input);
  const blocks = [
    header(resume.basics),
    summarySection(resume),
    educationSection(resume),
    experienceSection(resume),
    projectsSection(resume),
    activitiesSection(resume),
    skillsSection(resume),
    certificationsSection(resume),
    achievementsSection(resume),
  ].filter(Boolean);

  // A document with no content produces no PDF page at all, which is a LaTeX error. \null forces one.
  const body = blocks.length ? join(blocks, '\n\n') : tex`\null`;

  return tex`${PREAMBLE}

\begin{document}
${body}
\end{document}
`.toString();
}
