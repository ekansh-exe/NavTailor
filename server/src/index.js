// Entry point: check the configuration, connect to the database, then start listening.
//
// The app is loaded with a dynamic import() INSIDE a try, on purpose. config.js checks the environment
// as soon as it is loaded, and a static import would let its error crash the process with a long
// stack trace. Here a configuration problem prints one clear list and exits with code 1.

let app;
let config;
let configWarnings;
let connectDB;
let disconnectDB;
try {
  ({ config, configWarnings } = await import('./config.js'));
  ({ app } = await import('./app.js'));
  ({ connectDB, disconnectDB } = await import('./db.js'));
} catch (err) {
  if (err?.name === 'ConfigError') {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

for (const warning of configWarnings) console.warn(`Warning: ${warning}`);

try {
  // No database, no server: never accept requests we cannot serve.
  await connectDB();
} catch {
  process.exit(1);
}

const server = app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}${config.clientDist ? ', serving the client' : ''}`);
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
