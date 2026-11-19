const express = require('express');
const mongoose = require('mongoose');

const authRouter = require('./auth');
const meRouter = require('./me');
const foodsRouter = require('./foods');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    message: 'API is running',
    endpoints: [
      'GET /api/health',
      'POST /api/register',
      'POST /api/login',
      'GET /api/me',
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

// auth.js declares /register and /login itself, so it mounts at the API root.
router.use(authRouter);
router.use('/me', meRouter);
router.use('/foods', foodsRouter);

module.exports = router;
