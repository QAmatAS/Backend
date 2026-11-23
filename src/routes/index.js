const express = require('express');
const mongoose = require('mongoose');

const authRouter = require('./auth');
const meRouter = require('./me');
const foodsRouter = require('./foods');

const router = express.Router();

// Development helper only: the production API should not advertise its surface.
if (process.env.NODE_ENV !== 'production') {
  router.get('/', (req, res) => {
    res.json({
      message: 'API is running',
      endpoints: [
        'GET /api/health',
        'POST /api/register',
        'POST /api/login',
        'GET /api/me',
        'PATCH /api/me',
        'POST /api/me/avatar',
        'DELETE /api/me/avatar',
        'GET /api/me/listings',
        'GET /api/foods',
        'GET /api/foods/new',
        'GET /api/foods/:id',
        'POST /api/foods',
        'PATCH /api/foods/:id',
        'PATCH /api/foods/:id/status',
        'PATCH /api/foods/:id/verify',
        'DELETE /api/foods/:id',
      ],
    });
  });
}

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
