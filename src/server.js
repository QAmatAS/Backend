require('dotenv').config();

const app = require('./app');
const { connectDB, disconnectDB } = require('./config/db');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

async function startServer({ port = PORT, host = HOST } = {}) {
  await connectDB();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      console.log(`Server running at http://localhost:${port}`);
      resolve(server);
    });

    server.once('error', reject);
  });
}

// Close the HTTP server and the database connection on Ctrl+C / container shutdown.
function installShutdownHandlers(server, onShutdown) {
  async function shutdown() {
    console.log('Shutting down server...');

    if (onShutdown) {
      await onShutdown();
    }

    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  startServer()
    .then((server) => installShutdownHandlers(server))
    .catch((err) => {
      console.error('Failed to start server:', err.message);
      process.exit(1);
    });
}

module.exports = { startServer, installShutdownHandlers, PORT, HOST };
