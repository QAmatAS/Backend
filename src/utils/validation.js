/**
 * Small helpers shared by the query routes, so validation behaves the same
 * everywhere (same error shape, same messages).
 */

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates an optional enum query parameter. Returns null when absent, so a
 * typo produces 400 instead of a silently empty page.
 */
function parseEnumParam(value, allowed, field) {
  if (value === undefined || value === null || value === '') return null;

  if (!allowed.includes(value)) {
    throw httpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  }

  return value;
}

function parseBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

module.exports = {
  httpError,
  escapeRegex,
  parseEnumParam,
  parseBoundedInt,
};
