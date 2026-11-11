import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});
