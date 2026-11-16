const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');

const router = express.Router();

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }

  return 'dev-only-insecure-secret';
}

// POST /api/login
router.post('/', async (req, res, next) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    const error = new Error('email and password are required');
    error.status = 400;
    return next(error);
  }

  // passwordHash is select:false, so ask for it explicitly.
  const user = await User.findOne({ email: String(email).trim().toLowerCase() }).select(
    '+passwordHash'
  );

  // Same response for unknown email and wrong password, so accounts cannot be enumerated.
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    return next(error);
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || '1d';
  const token = jwt.sign(
    { sub: user._id.toString(), email: user.email },
    getJwtSecret(),
    { expiresIn }
  );

  res.json({
    token,
    tokenType: 'Bearer',
    expiresIn,
    user: user.toPublic(),
  });
});

module.exports = router;
