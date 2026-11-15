const express = require('express');

const router = express.Router();

// In-memory data store, just for demonstration.
// Replace this with a real database (e.g. Prisma, Sequelize, Mongoose) later.
let users = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' },
];
let nextId = 3;

// GET /api/users
router.get('/', (req, res) => {
  res.json({ data: users });
});

// GET /api/users/:id
router.get('/:id', (req, res, next) => {
  const user = users.find((u) => u.id === Number(req.params.id));

  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    return next(error);
  }

  res.json({ data: user });
});

// POST /api/users
router.post('/', (req, res, next) => {
  const { name, email } = req.body || {};

  if (!name || !email) {
    const error = new Error('name and email are required');
    error.status = 400;
    return next(error);
  }

  const user = { id: nextId++, name, email };
  users.push(user);

  res.status(201).json({ data: user });
});

// DELETE /api/users/:id
router.delete('/:id', (req, res, next) => {
  const id = Number(req.params.id);
  const exists = users.some((u) => u.id === id);

  if (!exists) {
    const error = new Error('User not found');
    error.status = 404;
    return next(error);
  }

  users = users.filter((u) => u.id !== id);
  res.status(204).send();
});

module.exports = router;
