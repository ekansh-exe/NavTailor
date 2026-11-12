import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { profileRouter } from './routes/profile.js';
import { createDevRouter } from './routes/dev.js';

export const app = express();

// Security headers (no sniffing, no framing, etc.).
app.use(helmet());

// Only our own client may call the API from a browser, and it may send cookies.
app.use(
  cors({
    origin: config.clientOrigin,
    credentials: true,
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

// Dev-only tools. In production this is never mounted, so the URL is a plain 404.
if (!config.isProduction) {
  app.use('/api/dev', createDevRouter());
}
