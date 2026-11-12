// Matching rules shared by every tailoring step: scoring, the guardrail and the gap report.
// Everything here is plain code (no LLM), so the same question always gets the same answer.
//
// Two jobs:
//   1. "Is this term in this text?"   -> containsTerm(), sameTerm()
//   2. "Which numbers are in this text?" -> extractNumbers()

// Lowercase, keep letters, digits and + # . (so "C++", "C#", "Node.js" survive), collapse the rest
// into single spaces. Same idea as norm() in import/buildDraft.js.
export const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- aliases: different spellings of the same thing ----------
// The first entry is the canonical spelling. Matching accepts every form in the group.
const GROUPS = [
  ['JavaScript', 'js', 'ecmascript'],
  ['TypeScript', 'ts'],
  ['Node.js', 'node', 'nodejs', 'node js'],
  ['React', 'react.js', 'reactjs'],
  ['Vue', 'vue.js', 'vuejs'],
  ['Angular', 'angularjs', 'angular.js'],
  ['Next.js', 'nextjs'],
  ['Express', 'express.js', 'expressjs'],
  ['PostgreSQL', 'postgres', 'postgre'],
  ['MongoDB', 'mongo'],
  ['Kubernetes', 'k8s'],
  ['Go', 'golang'],
  ['C#', 'csharp', 'c sharp'],
  ['C++', 'cpp'],
  ['AWS', 'amazon web services'],
  ['GCP', 'google cloud', 'google cloud platform'],
  ['Azure', 'microsoft azure'],
  ['CI/CD', 'ci cd', 'cicd'],
  ['Machine Learning', 'ml'],
  ['Artificial Intelligence', 'ai'],
  ['REST', 'rest api', 'restful', 'restful api'],
  ['GitHub Actions', 'github action'],
  ['Spring Boot', 'springboot'],
  ['Elasticsearch', 'elastic search'],
  ['Power BI', 'powerbi'],
  ['scikit-learn', 'sklearn', 'scikit learn'],
];

const stripDots = (n) => n.replace(/\.+$/, '');
const groupOf = new Map(); // normalised member -> normalised canonical
const membersOf = new Map(); // normalised canonical -> normalised members
for (const group of GROUPS) {
  const members = group.map((m) => stripDots(norm(m)));
  for (const m of members) groupOf.set(m, members[0]);
  membersOf.set(members[0], members);
}

// Words that are also everyday English. A model writing "go to market" or "react to feedback"
// must not look like it named a tool.
//   ALWAYS_CAP: matched only when capitalised ("Go", "C", "R"), in every check.
//   GUARD_CAP:  matched only when capitalised while the guardrail looks for invented names, so
//               "express interest" or "spring" never trips it. Scoring stays case-insensitive.
const ALWAYS_CAP = new Set(['go', 'c', 'r']);
const GUARD_CAP = new Set(['express', 'spring', 'excel', 'swift', 'spark', 'lambda', 'rails', 'ruby', 'oracle', 'node', 'react', 'rust', 'angular', 'unity']);

// First letter must be uppercase, the rest may be any case.
const capitalFirst = (v) =>
  escapeRegex(v[0].toUpperCase()) + [...v.slice(1)].map((ch) => (/[a-z]/.test(ch) ? `[${ch}${ch.toUpperCase()}]` : escapeRegex(ch))).join('');

// A stable identity for a term: "Postgres" and "PostgreSQL" share one, "microservice" and
// "microservices" share one.
export function canonKey(term) {
  const n = stripDots(norm(term));
  if (groupOf.has(n)) return groupOf.get(n);
  return n.length > 4 && /[^s]s$/.test(n) ? n.slice(0, -1) : n;
}

export const sameTerm = (a, b) => canonKey(a) === canonKey(b);

function variantsOf(term) {
  const n = stripDots(norm(term));
  const canon = groupOf.get(n);
  return [...new Set([n, ...(canon ? membersOf.get(canon) : [])])].filter(Boolean);
}

const matcherCache = new Map();

function buildMatcher(term, guard) {
  const capitalised = []; // regexes tested against the original text (case matters)
  const plain = []; // regexes tested against the normalised text
  for (const v of variantsOf(term)) {
    if (ALWAYS_CAP.has(v) || (guard && GUARD_CAP.has(v))) {
      capitalised.push(new RegExp(`(?<![A-Za-z0-9+#])${capitalFirst(v)}(?![A-Za-z0-9+#&-])`));
      continue;
    }
    // Optional trailing "s", so "microservice" and "microservices" find each other.
    const base = /[a-z]s$/.test(v) && !/ss$/.test(v) && v.length > 4 ? v.slice(0, -1) : v;
    const plural = /[a-z]$/.test(base) && base.length > 3 ? 's?' : '';
    // Lookarounds instead of \b, because "+", "#" and "." belong to names ("C++", "Node.js").
    // That is why "Java" does not match inside "JavaScript" and "C" does not match inside "C++".
    plain.push(new RegExp(`(?<![a-z0-9+#])${escapeRegex(base)}${plural}(?![a-z0-9+#])`));
  }
  return (text) => {
    const raw = String(text);
    const normalised = norm(raw);
    return capitalised.some((re) => re.test(raw)) || plain.some((re) => re.test(normalised));
  };
}

// Is `term` (or an alias of it) written in `text`?
// guard: true is used by the guardrail only, to be strict about everyday-word tool names.
export function containsTerm(text, term, { guard = false } = {}) {
  const key = `${guard ? 'g' : 'l'}|${term}`;
  let matcher = matcherCache.get(key);
  if (!matcher) {
    matcher = buildMatcher(term, guard);
    matcherCache.set(key, matcher);
  }
  return matcher(text);
}

// ---------- numbers ----------

// A number with an optional unit: 40%, 3x, $2M, 1,200, 2.5, 10 million, 40 percent.
// The lookbehind skips digits that are part of a name (S3, EC2, k8s, Python3).
// The decimal part needs digits after the dot, so the full stop ending "by 40." is not part of it.
const NUMBER =
  /(?<![A-Za-z0-9])[$€£₹]?(\d[\d,]*(?:\.\d+)?)(?:\s?(million\b|billion\b|thousand\b|percent\b|%|mm\b|bn\b|x\b|k\b|m\b|b\b))?/gi;

const UNIT = { '%': '%', percent: '%', x: 'x', k: 'k', thousand: 'k', m: 'm', mm: 'm', million: 'm', b: 'b', bn: 'b', billion: 'b' };

// Number words. "one" is left out on purpose: it is far too common in ordinary sentences.
const WORD_VALUES = {
  zero: '0', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60',
  seventy: '70', eighty: '80', ninety: '90', hundred: '100', thousand: '1000', million: '1000000',
  billion: '1000000000', dozen: '12',
  half: 'half', double: 'double', triple: 'triple', quadruple: 'quadruple',
  dozens: 'dozens', hundreds: 'hundreds', thousands: 'thousands', millions: 'millions',
};
const WORD = new RegExp(`\\b(${Object.keys(WORD_VALUES).join('|')})\\b`, 'gi');

// Returns normalised tokens, so equal quantities compare equal however they were written:
//   "40%" and "40 percent" -> "40%"      "$2M" and "2 million" -> "2m"
//   "1,200" and "1200" -> "1200"         "two" and "2" -> "2"
export function extractNumbers(text) {
  const tokens = [];
  const rest = String(text).replace(NUMBER, (_whole, core, unit) => {
    const digits = core.replace(/,/g, '');
    const value = Number.isNaN(Number(digits)) ? digits : String(Number(digits));
    tokens.push(value + (unit ? UNIT[unit.toLowerCase()] : ''));
    return ' '; // blanked, so "40 thousand" is not counted again as the word "thousand"
  });
  for (const [word] of rest.matchAll(WORD)) tokens.push(WORD_VALUES[word.toLowerCase()]);
  return tokens;
}

export const hasNumber = (text) => extractNumbers(text).length > 0;
