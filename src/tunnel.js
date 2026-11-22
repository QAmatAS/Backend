require('dotenv').config();

const localtunnel = require('localtunnel');

const { startServer, installShutdownHandlers, PORT } = require('./server');

// Fixed public name so the mobile app can keep one base URL between restarts.
// Override with TUNNEL_SUBDOMAIN in .env if this name is already taken.
const DEFAULT_SUBDOMAIN = 'spoonshare-test-tunnel';

// Usage: npm run tunnel
// Starts the API as usual, then exposes it through a public localtunnel URL.
async function main() {
  const server = await startServer();

  const subdomain = process.env.TUNNEL_SUBDOMAIN || DEFAULT_SUBDOMAIN;
  const expectedUrl = `https://${subdomain}.loca.lt`;

  let tunnel;

  try {
    tunnel = await localtunnel({ port: PORT, subdomain });
  } catch (err) {
    // Keep the local API usable even when the tunnel service is unreachable.
    console.error('Failed to open localtunnel:', err.message);
    console.error(`Requested subdomain: ${subdomain}`);
    console.error(`The API is still running locally at http://localhost:${PORT}`);
    installShutdownHandlers(server);
    return;
  }

  // localtunnel can hand back a different name when the requested one is busy,
  // which would silently break the base URL configured in the app.
  if (tunnel.url !== expectedUrl) {
    console.warn(`Warning: requested ${expectedUrl} but got ${tunnel.url}`);
    console.warn('Set TUNNEL_SUBDOMAIN in .env to another free name.');
  }

  console.log(`\nPublic URL: ${tunnel.url}`);
  console.log(`Forwarding ${tunnel.url} -> http://localhost:${PORT}`);
  console.log(`App base URL: ${tunnel.url}`);
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
