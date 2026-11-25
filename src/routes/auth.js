const express = require('express');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const { signToken, getJwtExpiresIn } = require('../config/jwt');

const router = express.Router();

const MIN_PASSWORD_LENGTH = 6;
// bcrypt only reads the first 72 bytes of a password and ignores the rest, so a
// longer password would silently accept anything that shares its first 72 bytes.
const MAX_PASSWORD_BYTES = 72;
const BCRYPT_ROUNDS = 10;

// POST /api/register
router.post('/register', async (req, res, next) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    const error = new Error('name, email and password are required');
    error.status = 400;
    return next(error);
  }

  // A JSON number or object would make bcrypt throw, which surfaced as a 500.
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    const error = new Error('name, email and password must be strings');
    error.status = 400;
    return next(error);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    const error = new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    error.status = 400;
    return next(error);
  }

  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    const error = new Error(`password must be at most ${MAX_PASSWORD_BYTES} bytes`);
    error.status = 400;
    return next(error);
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (await User.exists({ email: normalizedEmail })) {
    const error = new Error('Email is already registered');
    error.status = 409;
    return next(error);
  }

  const user = await User.create({
    name,
    email: normalizedEmail,
    // Async hashing keeps the server responsive while bcrypt works.
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
  });

  res.status(201).json({ data: user.toPublic() });
});

// POST /api/login
router.post('/login', async (req, res, next) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    const error = new Error('email and password are required');
    error.status = 400;
    return next(error);
  }

  if (typeof email !== 'string' || typeof password !== 'string') {
    const error = new Error('email and password must be strings');
    error.status = 400;
    return next(error);
  }

  // passwordHash is select:false, so ask for it explicitly.
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select(
    '+passwordHash'
  );

  // Same response for unknown email and wrong password, so accounts cannot be enumerated.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    return next(error);
  }

  res.json({
    token: signToken(user),
    tokenType: 'Bearer',
    expiresIn: getJwtExpiresIn(),
    user: user.toPublic(),
  });
});

module.exports = router;
