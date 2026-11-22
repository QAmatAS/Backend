// Centralized error handler. Express recognizes it by the 4-argument signature.
// Express 5 forwards rejected promises from async route handlers here automatically.

// A duplicate-key error is only meaningful with the field that collided, so map
// each unique field to its own message instead of assuming email.
const DUPLICATE_KEY_MESSAGES = {
  email: 'Email is already registered',
  user_id: 'user_id is already registered',
  food_id: 'food_id is already registered',
};

function duplicateKeyMessage(err) {
  const keyPattern = err.keyPattern || err.keyValue || {};
  const fields = Object.keys(keyPattern);

  for (const field of fields) {
    if (DUPLICATE_KEY_MESSAGES[field]) return DUPLICATE_KEY_MESSAGES[field];
  }

  return fields.length > 0 ? `${fields[0]} is already registered` : 'Duplicate value';
}

function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message;

  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
  } else if (err.name === 'CastError') {
    status = 400;
    message = err.path === '_id' ? 'Invalid id' : `Invalid ${err.path}`;
  } else if (err.name === 'MulterError') {
    status = 400;
    const messages = {
      LIMIT_FILE_SIZE: 'each photo must be at most 5 MB',
      LIMIT_FILE_COUNT: 'at most 5 photos are allowed',
      LIMIT_UNEXPECTED_FILE: 'unexpected file field; use `photos` (max 5 files)',
    };
    message = messages[err.code] || err.message;
  } else if (err.code === 11000) {
    status = 409;
    message = duplicateKeyMessage(err);
  }

  if (status >= 500) {
    message = 'Internal server error';
    if (process.env.NODE_ENV !== 'test') console.error(err);
  }

  res.status(status).json({ error: { message } });
}

module.exports = errorHandler;
