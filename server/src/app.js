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

// Security headers with helmet's defaults: Content-Security-Policy, X-Content-Type-Options: nosniff,
// X-Frame-Options (no framing), Strict-Transport-Security, Referrer-Policy, and no X-Powered-By.
app.use(helmet());

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

// Dev-only tools. In production this is never mounted, so the URL is a plain 404.
if (!config.isProduction) {
  app.use('/api/dev', createDevRouter());
}

// Errors from the JSON body parser. Without this, Express answers with an HTML error page, which the
// client cannot read. Must be the LAST app.use and take four arguments, so Express treats it as an
// error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request is too large.', code: 'too_large' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON.', code: 'bad_json' });
  }
  console.error('unhandled error:', err?.name ?? 'Error');
  return res.status(500).json({ error: 'Something went wrong', code: 'internal' });
});
