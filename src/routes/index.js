const express = require('express');
const mongoose = require('mongoose');

const usersRouter = require('./users');
const loginRouter = require('./login');
const foodsRouter = require('./foods');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    message: 'API is running',
    endpoints: [
      'GET /api/health',
      'POST /api/login',
      'GET /api/users',
      'POST /api/users',
      'GET /api/foods',
      'GET /api/foods/:id',
      'POST /api/foods',
      'PATCH /api/foods/:id',
      'DELETE /api/foods/:id',
    ],
  });
});

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
  });
});

router.use('/login', loginRouter);
router.use('/users', usersRouter);
router.use('/foods', foodsRouter);

module.exports = router;
