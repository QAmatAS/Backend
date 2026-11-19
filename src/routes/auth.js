const express = require('express');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const { signToken, getJwtExpiresIn } = require('../config/jwt');

const router = express.Router();

// POST /api/register
router.post('/register', async (req, res, next) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    const error = new Error('name, email and password are required');
    error.status = 400;
    return next(error);
  }

  if (String(password).length < 6) {
    const error = new Error('password must be at least 6 characters');
    error.status = 400;
    return next(error);
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  if (await User.exists({ email: normalizedEmail })) {
    const error = new Error('Email is already registered');
    error.status = 409;
    return next(error);
  }

  const user = await User.create({
    name,
    email: normalizedEmail,
    passwordHash: bcrypt.hashSync(password, 10),
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

  res.json({
    token: signToken(user),
    tokenType: 'Bearer',
    expiresIn: getJwtExpiresIn(),
    user: user.toPublic(),
  });
});

module.exports = router;
