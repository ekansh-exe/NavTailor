// Checks the environment variables BEFORE anything uses them. A pure function (env in, result out),
// so it can be tested without starting a server.
//
// Messages name the VARIABLE and what is wrong with it, never its value: these lines go to the host's
// logs, and a "wrong" value is often a real secret pasted into the wrong field.

const MIN_JWT_SECRET = 32;

const isInt = (v, min, max) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;

function isHttpOrigin(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

// Returns { problems: string[], warnings: string[] }. Any problem means: do not start.
export function checkEnv(env) {
  const problems = [];
  const warnings = [];
  const missing = (name) => !env[name] || !String(env[name]).trim();

  for (const name of ['MONGODB_URI', 'JWT_SECRET', 'GOOGLE_CLIENT_ID', 'CLIENT_ORIGIN']) {
    if (missing(name)) problems.push(`${name} is missing`);
  }

  if (!missing('MONGODB_URI') && !/^mongodb(\+srv)?:\/\//.test(env.MONGODB_URI)) {
    problems.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }
  // Anyone who guesses the secret can sign in as any user. 32 characters is the floor; generate one
  // with `openssl rand -hex 32` (64 characters).
  if (!missing('JWT_SECRET') && env.JWT_SECRET.length < MIN_JWT_SECRET) {
    problems.push(`JWT_SECRET is too short: use at least ${MIN_JWT_SECRET} random characters (openssl rand -hex 32)`);
  }
  if (!missing('CLIENT_ORIGIN') && !isHttpOrigin(env.CLIENT_ORIGIN.replace(/\/+$/, ''))) {
    problems.push('CLIENT_ORIGIN must be an origin like https://navtailor.onrender.com (no path)');
  }
  if (env.PORT && !isInt(env.PORT, 1, 65535)) problems.push('PORT must be a whole number from 1 to 65535');
  // More than a handful of hops is never right, and trusting too many lets a client choose its IP.
  if (env.TRUST_PROXY && !isInt(env.TRUST_PROXY, 0, 5)) problems.push('TRUST_PROXY must be a whole number from 0 to 5');

  // Allowed, but worth saying out loud.
  if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY) {
    warnings.push('No GEMINI_API_KEY or GROQ_API_KEY: tailoring and resume import will fail with 502');
  }
  if (env.NODE_ENV === 'production' && !missing('CLIENT_ORIGIN') && env.CLIENT_ORIGIN.startsWith('http://') && !/^http:\/\/localhost(:\d+)?\/?$/.test(env.CLIENT_ORIGIN)) {
    warnings.push('CLIENT_ORIGIN uses http:// in production: the session cookie is Secure and needs https');
  }

  return { problems, warnings };
}

// Thrown by config.js when checkEnv finds problems. index.js prints `message` (no stack) and exits.
export class ConfigError extends Error {
  constructor(problems) {
    super(
      [
        'NavTailor cannot start: the server configuration is incomplete.',
        ...problems.map((p) => `  - ${p}`),
        'Set these in server/.env for local development, or in your host\'s environment settings.',
      ].join('\n'),
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}
