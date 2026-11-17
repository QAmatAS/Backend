require('dotenv').config();

const localtunnel = require('localtunnel');

const { startServer, installShutdownHandlers, PORT } = require('./server');

// Usage: npm run tunnel
// Starts the API as usual, then exposes it through a public localtunnel URL.
async function main() {
  const server = await startServer();

  const options = { port: PORT };
  if (process.env.TUNNEL_SUBDOMAIN) {
    options.subdomain = process.env.TUNNEL_SUBDOMAIN;
  }

  let tunnel;

  try {
    tunnel = await localtunnel(options);
  } catch (err) {
    // Keep the local API usable even when the tunnel service is unreachable.
    console.error('Failed to open localtunnel:', err.message);
    console.error(`The API is still running locally at http://localhost:${PORT}`);
    installShutdownHandlers(server);
    return;
  }

  console.log(`\nPublic URL: ${tunnel.url}`);
  console.log(`Forwarding ${tunnel.url} -> http://localhost:${PORT}`);
  console.log('Keep this terminal open. Press Ctrl+C to stop.\n');

  tunnel.on('close', () => {
    console.log('Localtunnel closed.');
  });

  tunnel.on('error', (err) => {
    console.error('Localtunnel error:', err.message);
  });

  installShutdownHandlers(server, async () => {
    tunnel.close();
  });
}

main().catch((err) => {
  console.error('Failed to start tunnel:', err.message);
  process.exit(1);
});
