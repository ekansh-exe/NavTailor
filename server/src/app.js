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

export const app = express();

// Security headers (no sniffing, no framing, etc.).
app.use(helmet());

// Only our own client may call the API from a browser, and it may send cookies.
app.use(
  cors({
    origin: config.clientOrigin,
    credentials: true,
    // Without this a browser on another port cannot read the PDF report headers (see routes/resume.js).
    exposedHeaders: ['X-Resume-Pages', 'X-Resume-Dropped', 'X-Resume-Fit'],
  }),
);

// Parse JSON request bodies into req.body.
app.use(express.json());

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

// Dev-only tools. In production this is never mounted, so the URL is a plain 404.
if (!config.isProduction) {
  app.use('/api/dev', createDevRouter());
}
