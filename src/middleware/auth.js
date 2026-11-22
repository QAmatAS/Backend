const mongoose = require('mongoose');

const User = require('../models/User');
const { verifyToken } = require('../config/jwt');
const { httpError } = require('../utils/validation');

/**
 * Reads `Authorization: Bearer <token>` and returns the raw token, or null.
 */
function extractToken(req) {
  const header = req.get('authorization');
  if (!header) return null;

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Resolves the token into a User document. Throws 401 for anything that is not
 * a valid, unexpired token belonging to an existing user.
 */
async function resolveUser(token) {
  let payload;

  try {
    payload = verifyToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw httpError(401, 'Token expired');
    }
    throw httpError(401, 'Invalid token');
  }

  if (!payload.sub || !mongoose.isValidObjectId(payload.sub)) {
    throw httpError(401, 'Invalid token');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw httpError(401, 'Invalid token');

  return user;
}

/**
 * Requires a valid token. Sets req.user, or answers 401.
 */
async function authenticate(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw httpError(401, 'Authentication required');

    req.user = await resolveUser(token);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Attaches req.user when a valid token is present and stays silent otherwise.
 * Used by public read routes that behave slightly differently for owners.
 */
async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    req.user = await resolveUser(token);
  } catch (err) {
    // A bad token on a public route is ignored, not rejected.
  }

  return next();
}

/**
 * Must run after authenticate. Answers 403 when the user lacks every role.
 */
function requireRole(...roles) {
  return function authorize(req, res, next) {
    if (!req.user) return next(httpError(401, 'Authentication required'));
    if (!roles.includes(req.user.role)) return next(httpError(403, 'Forbidden'));
    return next();
  };
}

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
};
