import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';

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
