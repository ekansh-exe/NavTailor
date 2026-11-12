import { app } from './app.js';
import { config } from './config.js';
import { connectDB, disconnectDB } from './db.js';

try {
  // No database, no server: never accept requests we cannot serve.
  await connectDB();
} catch {
  process.exit(1);
}

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});

// Ctrl+C (SIGINT) or a host stopping us (SIGTERM): stop taking requests,
// then close the DB connection cleanly.
async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close();
  await disconnectDB();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
