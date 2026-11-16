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
