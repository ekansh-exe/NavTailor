import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { profileRouter } from './routes/profile.js';
import { createDevRouter } from './routes/dev.js';
import { createResumeRouter } from './routes/resume.js';
import { createTailorRouter } from './routes/tailor.js';
import { createApplicationsRouter } from './routes/applications.js';

export const app = express();

// Behind a hosting proxy, req.ip would otherwise be the proxy's IP for every visitor.
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

// Security headers. Helmet's defaults (nosniff, no framing by other sites, HSTS, no X-Powered-By, a
// strict Content-Security-Policy) with the exceptions the real page needs, now that this server also
// serves the React app:
//   - Google Identity Services: its script, its sign-in iframe/popup and its stylesheet
//     (https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#content_security_policy)
//   - Google Fonts: the stylesheet and the font files (index.html)
//   - blob: frames, for the PDF preview (an iframe on a blob: URL, see components/result/PdfPanel.jsx)
// No 'unsafe-inline' for scripts: an injected <script> still cannot run.
const GSI = 'https://accounts.google.com/gsi/';
export const helmetOptions = {
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", `${GSI}client`],
      styleSrc: ["'self'", "'unsafe-inline'", `${GSI}style`, 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      frameSrc: ["'self'", 'blob:', GSI],
      connectSrc: ["'self'", GSI],
      // HTTPS is enforced by HSTS and the host. Upgrading requests here would break a local
      // http://localhost test of the container.
      upgradeInsecureRequests: null,
    },
  },
  // Helmet's default (same-origin) cuts the link between our page and Google's sign-in popup.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  // Google checks which site the sign-in comes from; "no-referrer" would hide it.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
};
app.use(helmet(helmetOptions));

// Only our own client may call the API from a browser, and it may send cookies.
app.use(
  cors({
    origin: config.clientOrigin,
    credentials: true,
    // Without this a browser on another port cannot read the PDF report headers (see routes/resume.js)
    // or how long to wait after a 429 (Retry-After).
    exposedHeaders: ['X-Resume-Pages', 'X-Resume-Dropped', 'X-Resume-Fit', 'Retry-After'],
  }),
);

// Parse JSON request bodies into req.body. Anything bigger than the limit is refused with 413 before
// it is read into memory. File uploads are capped separately by multer (routes/profileImport.js).
// Saving an application sends the whole signed tailoring result plus the job description back, which
// can pass the default 100 kB. Only that path gets a bigger limit. The global parser below then sees
// the body is already parsed and skips it.
app.use('/api/applications', express.json({ limit: '400kb' }));
app.use(express.json({ limit: '100kb' }));

// Parse the Cookie header into req.cookies (needed to read our session cookie).
app.use(cookieParser());

app.get('/api/health', (req, res) => {
  // Temporary deploy aid (LOG_PROXY_HOPS=1): how many entries X-Forwarded-For has when the host's proxy
  // forwards a request. That number is what TRUST_PROXY should be. Only the count is logged, never an IP.
  if (config.logProxyHops) {
    const xff = req.get('x-forwarded-for');
    console.log(`proxy check: xff_entries=${xff ? xff.split(',').length : 0}`);
  }
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);

// Resume -> PDF / LaTeX source. Auth is applied inside the router.
app.use('/api/resume', createResumeRouter());

// Job description -> tailored one-page resume content. Saves nothing. Auth is applied inside.
app.use('/api/tailor', createTailorRouter());

// Saved tailoring runs (one user, many applications). Auth is applied inside.
app.use('/api/applications', createApplicationsRouter());

// Dev-only tools, mounted ONLY with NODE_ENV=development (npm run dev). Everywhere else, including a
// server where NODE_ENV was forgotten, the URL is a plain 404.
if (config.isDevelopment) {
  app.use('/api/dev', createDevRouter());
}

// Any /api path that no router answered: a JSON 404, never the React app's index.html.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));

// The built React app, from the same origin as the API (see config.clientDist). One origin means the
// session cookie is first-party and no CORS request ever happens.
if (config.clientDist) {
  // Vite puts a content hash in every file name under /assets, so a changed file gets a new URL and
  // the old one can be cached for a year.
  app.use(
    '/assets',
    express.static(path.join(config.clientDist, 'assets'), { immutable: true, maxAge: '1y', index: false, fallthrough: false }),
  );
  app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));

  // Every other GET is a page of the React app (/app, /app/result/<id>, ...): send index.html and let
  // React Router pick the page. no-cache: a new deploy is picked up on the next visit.
  app.get('/{*splat}', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.clientDist, 'index.html'));
  });
}

// The LAST middleware: every error ends here, and the answer is always short JSON. No stack trace, no
// error message and no file path ever reaches the user (Express's own handler would show a stack trace
// outside production). Four arguments, so Express treats it as an error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // The response already started (e.g. a PDF stream broke halfway): all we can do is close it.
  if (res.headersSent) return req.socket?.destroy();
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request is too large.', code: 'too_large' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON.', code: 'bad_json' });
  }
  // A missing static file under /assets (express.static with fallthrough: false).
  if (err?.status === 404 || err?.statusCode === 404) {
    return res.status(404).json({ error: 'Not found', code: 'not_found' });
  }
  console.error('unhandled error:', err?.name ?? 'Error');
  return res.status(500).json({ error: 'Something went wrong', code: 'internal' });
});
