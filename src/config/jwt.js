const jwt = require('jsonwebtoken');

// Single source of truth for the signing secret. Signing (login) and verifying
// (middleware) import this module, so they can never drift apart.
const DEV_SECRET = 'dev-only-insecure-secret';
// The value shipped in .env.example. Both secrets are public (they are in the
// repository), so a token signed with either can be forged by anyone.
const EXAMPLE_SECRET = 'change-me-to-a-long-random-string';

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }

  return DEV_SECRET;
}

function getJwtExpiresIn() {
  return process.env.JWT_EXPIRES_IN || '1d';
}

// Warn (never block) when the signing secret is one that is published in the
// repository. This matters as soon as the API is reachable through the public
// tunnel: anyone could then sign a token for any account.
function warnIfPublicSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret === DEV_SECRET || secret === EXAMPLE_SECRET) {
    console.warn(
      'WARNING: JWT_SECRET is missing or still a placeholder from the repository. ' +
        'Anyone can forge login tokens while the API is public. ' +
        'Set a random value in .env (see .env.example).'
    );
  }
}

// Fail at boot instead of on the first login request, so a missing secret is
// a startup error rather than a 500 that looks like a bug in the login route.
function assertJwtConfig() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
  }

  warnIfPublicSecret();
}

function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email },
    getJwtSecret(),
    { expiresIn: getJwtExpiresIn() }
  );
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

module.exports = {
  getJwtSecret,
  getJwtExpiresIn,
  assertJwtConfig,
  signToken,
  verifyToken,
};
