const jwt = require('jsonwebtoken');

// Single source of truth for the signing secret. Signing (login) and verifying
// (middleware) import this module, so they can never drift apart.
const DEV_SECRET = 'dev-only-insecure-secret';

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

// Fail at boot instead of on the first login request, so a missing secret is
// a startup error rather than a 500 that looks like a bug in the login route.
function assertJwtConfig() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
  }
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
