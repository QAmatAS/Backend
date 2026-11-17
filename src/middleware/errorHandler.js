// Centralized error handler. Express recognizes it by the 4-argument signature.
// Express 5 forwards rejected promises from async route handlers here automatically.
// eslint-disable-next-line no-unused-vars
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
    message = 'Email is already registered';
  }

  if (status >= 500) {
    message = 'Internal server error';
    if (process.env.NODE_ENV !== 'test') console.error(err);
  }

  res.status(status).json({ error: { message } });
}

module.exports = errorHandler;
