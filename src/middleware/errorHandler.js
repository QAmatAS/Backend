// Centralized error handler. Express recognizes it by the 4-argument signature.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = status === 500 ? 'Internal server error' : err.message;

  if (process.env.NODE_ENV !== 'test' && status === 500) {
    console.error(err);
  }

  res.status(status).json({ error: { message } });
}

module.exports = errorHandler;
