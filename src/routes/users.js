const express = require('express');
const bcrypt = require('bcryptjs');

const User = require('../models/User');

const router = express.Router();

// GET /api/users
router.get('/', async (req, res) => {
  const users = await User.find().sort({ createdAt: 1 });
  res.json({ data: users.map((user) => user.toPublic()) });
});

// GET /api/users/:id
router.get('/:id', async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    return next(error);
  }

  res.json({ data: user.toPublic() });
});

// POST /api/users  (register)
router.post('/', async (req, res, next) => {
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

// DELETE /api/users/:id
router.delete('/:id', async (req, res, next) => {
  const user = await User.findByIdAndDelete(req.params.id);

  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    return next(error);
  }

  res.status(204).send();
});

module.exports = router;
